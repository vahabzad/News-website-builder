import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Codex, type Thread, type ThreadItem } from "@openai/codex-sdk";
import { nanoid } from "nanoid";
import { resolveCodexExecutable } from "./codex-executable.js";
import { projectWorkspace, promptFile } from "./paths.js";
import { findProject, readDatabase, updateProject, updateProjectProgress } from "./store.js";
import type { BuildProgress, BuildProgressEvent } from "./types.js";

const execFileAsync = promisify(execFile);
const activeJobs = new Set<string>();
const ALLOWED_DEPENDENCIES = new Set(["next", "react", "react-dom", "typescript", "@types/node", "@types/react", "@types/react-dom"]);
const FILE_CREDENTIAL_ARGS = ["--config", 'cli_auth_credentials_store="file"'];
const MAX_PROGRESS_EVENTS = 60;
const CODEX_IDLE_TIMEOUT_MS = 5 * 60_000;

function newProgress(stage: BuildProgress["stage"], message: string): BuildProgress {
  const now = new Date().toISOString();
  return { stage, message, startedAt: now, lastActivityAt: now, events: [{ id: nanoid(), at: now, kind: "info", message }] };
}

export function queuedProgress(message = "درخواست ساخت در صف اجرا قرار گرفت.") {
  return newProgress("queued", message);
}

export async function recoverInterruptedJobs() {
  const interrupted = (await readDatabase()).projects.filter((project) => ["queued", "generating", "building"].includes(project.status));
  for (const project of interrupted) {
    const now = new Date().toISOString();
    const message = "اجرای قبلی با توقف یا راه‌اندازی مجدد بک‌اند قطع شده است؛ دوباره تلاش کنید.";
    const progress = project.progress ?? newProgress("failed", message);
    const event: BuildProgressEvent = { id: nanoid(), at: now, kind: "error", message };
    await updateProject(project.id, {
      status: "failed",
      error: message,
      progress: {
        ...progress,
        stage: "failed",
        message,
        lastActivityAt: now,
        events: [...progress.events, event].slice(-MAX_PROGRESS_EVENTS),
      },
    });
  }
}

async function reportProgress(projectId: string, stage: BuildProgress["stage"], message: string, kind: BuildProgressEvent["kind"] = "info", eventId?: string) {
  const now = new Date().toISOString();
  await updateProjectProgress(projectId, (current) => {
    const progress = current ?? newProgress(stage, message);
    const id = eventId ?? nanoid();
    const event: BuildProgressEvent = { id, at: now, kind, message };
    const previous = progress.events.at(-1);
    const isImmediateDuplicate = !eventId && previous?.kind === kind && previous.message === message;
    const events = eventId
      ? [...progress.events.filter((item) => item.id !== eventId), event]
      : isImmediateDuplicate
        ? [...progress.events.slice(0, -1), { ...event, id: previous.id }]
        : [...progress.events, event];
    return {
      ...progress,
      stage,
      message,
      lastActivityAt: now,
      events: events.slice(-MAX_PROGRESS_EVENTS),
    };
  });
}

async function keepActivityFresh<T>(projectId: string, operation: Promise<T>) {
  const timer = setInterval(() => {
    void updateProjectProgress(projectId, (progress) => progress
      ? { ...progress, lastActivityAt: new Date().toISOString() }
      : newProgress("building", "فرایند ساخت در حال اجراست…")
    ).catch(() => undefined);
  }, 8_000);
  try {
    return await operation;
  } finally {
    clearInterval(timer);
  }
}

function compact(value: string, max = 110) {
  const line = value.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

async function resolveConfiguredModel() {
  const environmentModel = process.env.CODEX_MODEL?.trim();
  if (environmentModel) return environmentModel;
  const codexHome = process.env.CODEX_HOME?.trim() || path.join(homedir(), ".codex");
  try {
    const config = await readFile(path.join(codexHome, "config.toml"), "utf8");
    for (const line of config.split(/\r?\n/)) {
      if (/^\s*\[/.test(line)) break;
      const match = line.match(/^\s*model\s*=\s*["']([^"']+)["']/);
      if (match?.[1]) return match[1];
    }
  } catch {
    // If no explicit model is configured, Codex chooses its own default.
  }
  return "پیش‌فرض خودکار Codex";
}

function describeThreadItem(item: ThreadItem): { message: string; kind: BuildProgressEvent["kind"] } | null {
  switch (item.type) {
    case "command_execution":
      return { message: `${item.status === "in_progress" ? "اجرای دستور" : item.status === "failed" ? "دستور ناموفق" : "اجرای دستور کامل شد"}: ${compact(item.command)}`, kind: "command" };
    case "file_change": {
      const files = item.changes.slice(0, 3).map((change) => path.basename(change.path)).join("، ");
      const extra = item.changes.length > 3 ? ` و ${item.changes.length - 3} فایل دیگر` : "";
      return { message: `${item.status === "failed" ? "تغییر فایل ناموفق بود" : "فایل‌ها به‌روزرسانی شدند"}: ${files}${extra}`, kind: item.status === "failed" ? "error" : "file" };
    }
    case "mcp_tool_call":
      return { message: `${item.status === "in_progress" ? "استفاده از ابزار" : "کار ابزار تمام شد"}: ${compact(item.tool)}`, kind: "info" };
    case "web_search":
      return { message: `جست‌وجو: ${compact(item.query)}`, kind: "info" };
    case "todo_list": {
      const current = item.items.find((todo) => !todo.completed)?.text;
      return current ? { message: `مرحله فعلی: ${compact(current)}`, kind: "info" } : null;
    }
    case "error":
      return { message: `خطای Codex: ${compact(item.message)}`, kind: "error" };
    default:
      return null;
  }
}

function buildPrompt(template: string, data: Record<string, unknown>) {
  const adminData = JSON.stringify(data, null, 2);
  return `${template.replace("{{ADMIN_FORM_DATA}}", adminData)}

==================================================
قوانین قطعی پلتفرم سایت‌ساز
==================================================
- خروجی را فقط با Next.js App Router و TypeScript بساز؛ React/Vite ممنوع است.
- تمام فایل‌ها را مستقیماً در همین پوشه کاری ایجاد کن.
- پروژه باید static-export باشد و در next.config.ts مقدار output: "export" داشته باشد.
- فقط dependencyهای next، react، react-dom، typescript، @types/node، @types/react و @types/react-dom مجاز هستند. هیچ پکیج دیگری نصب نکن.
- از next/font/google، URLهای نیازمند دانلود در زمان build، API route و Server Action استفاده نکن.
- هیچ دستور npm install، npm ci، npx، next build یا npm run build اجرا نکن؛ پلتفرم پس از پایان تولید، نصب و Build را خودش انجام می‌دهد.
- محتوای سایت خبری می‌تواند Mock باشد اما باید کامل، واقعی‌نما و موضوعی باشد.
- دستور npm run build باید بدون تعامل کاربر موفق شود.
- سؤال نپرس و تا ایجاد تمام فایل‌های پروژه ادامه بده.`;
}

function projectInstructions(projectName: string) {
  return `# پروژه محلی Codex: ${projectName}\n\nاین پوشه خروجی سایت‌ساز خبری است. پروژه را فقط با Next.js App Router و TypeScript نگهداری کن. static export باید فعال بماند. dependency جدید خارج از next، react، react-dom و بسته‌های TypeScript اضافه نکن. تغییرات بعدی کاربر باید در همین پروژه انجام شوند و npm build موفق بماند.\n`;
}

async function validateGeneratedPackage(workspace: string) {
  const packagePath = path.join(workspace, "package.json");
  const pkg = JSON.parse(await readFile(packagePath, "utf8")) as {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  if (!pkg.scripts?.build || !/^next build(?:\s|$)/.test(pkg.scripts.build)) {
    throw new Error("خروجی Codex اسکریپت Build معتبر Next.js ندارد.");
  }
  const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
  const invalid = Object.keys(dependencies).filter((name) => !ALLOWED_DEPENDENCIES.has(name));
  if (invalid.length) throw new Error(`وابستگی غیرمجاز در خروجی: ${invalid.join(", ")}`);
  for (const version of Object.values(dependencies)) {
    if (/^(file:|git\+|https?:)/i.test(version)) throw new Error("منبع dependency غیرمجاز است.");
  }
}

async function buildGeneratedSite(projectId: string, workspace: string) {
  await reportProgress(projectId, "building", "در حال بررسی ساختار پروژه و وابستگی‌ها…");
  await validateGeneratedPackage(workspace);
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  await reportProgress(projectId, "installing", "در حال نصب وابستگی‌های پروژه…", "command");
  await keepActivityFresh(projectId, execFileAsync(npm, ["install", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: workspace, timeout: 8 * 60_000, maxBuffer: 2_000_000 }));
  await reportProgress(projectId, "installing", "نصب وابستگی‌ها کامل شد.", "success");
  const nextBinary = path.join(workspace, "node_modules", ".bin", process.platform === "win32" ? "next.cmd" : "next");
  await reportProgress(projectId, "building", "در حال ساخت خروجی نهایی Next.js…", "command");
  await keepActivityFresh(projectId, execFileAsync(nextBinary, ["build", "--webpack"], { cwd: workspace, timeout: 8 * 60_000, maxBuffer: 3_000_000 }));
  await reportProgress(projectId, "building", "ساخت خروجی Next.js با موفقیت تمام شد.", "success");
}

export async function getLocalCodexStatus() {
  const executable = await resolveCodexExecutable();
  if (!executable) return { ready: false, message: "Codex محلی روی سیستم پیدا نشد." };
  try {
    const { stdout, stderr } = await execFileAsync(executable, [...FILE_CREDENTIAL_ARGS, "login", "status"], { timeout: 10_000, windowsHide: true });
    const output = `${stdout}\n${stderr}`.trim();
    return { ready: !/not logged in/i.test(output), message: output || "وضعیت ورود Codex مشخص نیست." };
  } catch (error) {
    const output = error && typeof error === "object" && "stderr" in error ? String(error.stderr) : "";
    return { ready: false, message: output.trim() || "Codex CLI روی سیستم قابل اجرا نیست یا وارد حساب نشده است." };
  }
}

function localCodexEnvironment() {
  const blocked = new Set(["OPENAI_API_KEY", "CODEX_API_KEY", "OPENAI_BASE_URL"]);
  return Object.fromEntries(Object.entries(process.env).filter(([key, value]) => !blocked.has(key) && value !== undefined)) as Record<string, string>;
}

async function prepareInput(projectSpec: Record<string, unknown>, workspace: string) {
  const spec = structuredClone(projectSpec);
  if (typeof spec.uploadedLogo === "string") {
    const extension = path.extname(spec.uploadedLogo).toLowerCase();
    const assets = path.join(workspace, "input-assets");
    await mkdir(assets, { recursive: true });
    const target = path.join(assets, `logo${extension}`);
    await copyFile(spec.uploadedLogo, target);
    spec.uploadedLogo = `input-assets/logo${extension}`;
  }
  return spec;
}

async function streamCodexTurn(projectId: string, thread: Thread, input: string) {
  const controller = new AbortController();
  let idleTimer = setTimeout(() => controller.abort(), CODEX_IDLE_TIMEOUT_MS);
  const activityTimer = setInterval(() => {
    void updateProjectProgress(projectId, (progress) => progress
      ? { ...progress, lastActivityAt: new Date().toISOString() }
      : newProgress("generating", "Codex در حال تولید پروژه است…")
    ).catch(() => undefined);
  }, 8_000);
  const refreshIdleTimer = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => controller.abort(), CODEX_IDLE_TIMEOUT_MS);
  };
  const { events } = await thread.runStreamed(input, { signal: controller.signal });
  let finalResponse = "";
  try {
    for await (const event of events) {
      refreshIdleTimer();
      if (event.type === "thread.started") {
        await updateProject(projectId, { threadId: event.thread_id });
        await reportProgress(projectId, "generating", "جلسه Codex شروع شد؛ در حال بررسی نیازمندی‌ها…");
      } else if (event.type === "item.started" || event.type === "item.completed") {
        if (event.item.type === "agent_message" && event.type === "item.completed") finalResponse = event.item.text;
        const description = describeThreadItem(event.item);
        if (description) await reportProgress(projectId, "generating", description.message, description.kind, event.item.id);
      } else if (event.type === "turn.failed") {
        throw new Error(event.error.message);
      } else if (event.type === "error") {
        throw new Error(event.message);
      }
    }
    return finalResponse;
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Codex بیش از ۵ دقیقه هیچ فعالیتی نداشت و اجرای آن متوقف شد. دوباره تلاش کنید.");
    throw error;
  } finally {
    clearTimeout(idleTimer);
    clearInterval(activityTimer);
  }
}

function buildFailureDetails(error: unknown) {
  if (!error || typeof error !== "object") return String(error);
  const value = error as { message?: unknown; stdout?: unknown; stderr?: unknown };
  const details = [value.message, value.stdout, value.stderr].filter(Boolean).map(String).join("\n");
  return details.slice(-6_000);
}

async function runJob(projectId: string, continuation?: string) {
  if (activeJobs.has(projectId)) return;
  activeJobs.add(projectId);
  try {
    const project = await findProject(projectId);
    if (!project) throw new Error("پروژه پیدا نشد.");
    const workspace = projectWorkspace(projectId);
    if (!continuation) {
      await reportProgress(projectId, "preparing", "در حال آماده‌سازی پوشه کاری پروژه…");
      await rm(workspace, {
        recursive: true,
        force: true,
        maxRetries: 8,
        retryDelay: 250,
      });
      await mkdir(workspace, { recursive: true });
      await execFileAsync("git", ["init", "--quiet"], { cwd: workspace, timeout: 15_000, windowsHide: true });
      await writeFile(path.join(workspace, "AGENTS.md"), projectInstructions(project.name), "utf8");
    } else {
      await reportProgress(projectId, "preparing", "در حال باز کردن دوباره پروژه برای اعمال تغییرات…");
    }
    await reportProgress(projectId, "preparing", "در حال بررسی اتصال Codex محلی…");
    const login = await getLocalCodexStatus();
    if (!login.ready) throw new Error("Codex محلی وارد حساب ChatGPT نیست. در پوشه سایت‌ساز دستور npm run codex:login را اجرا کنید و سپس دوباره تلاش کنید.");
    const selectedModel = await resolveConfiguredModel();
    await updateProjectProgress(projectId, (progress) => ({ ...(progress ?? newProgress("generating", "شروع تولید پروژه…")), model: selectedModel }));
    await updateProject(projectId, { status: "generating", error: undefined });
    await reportProgress(projectId, "generating", continuation ? "Codex در حال اعمال تغییرات در پروژه است…" : "Codex در حال طراحی و تولید فایل‌های سایت است…");
    const codexPath = await resolveCodexExecutable();
    if (!codexPath) throw new Error("فایل اجرایی Codex محلی پیدا نشد.");
    const codex = new Codex({
      codexPathOverride: codexPath,
      env: localCodexEnvironment(),
      config: { forced_login_method: "chatgpt", cli_auth_credentials_store: "file" },
    });
    const threadOptions = {
      workingDirectory: workspace,
      skipGitRepoCheck: true,
      sandboxMode: "workspace-write" as const,
      approvalPolicy: "never" as const,
      networkAccessEnabled: false,
      ...(selectedModel !== "پیش‌فرض خودکار Codex" ? { model: selectedModel } : {}),
    };
    let thread = continuation && project.threadId ? codex.resumeThread(project.threadId, threadOptions) : codex.startThread(threadOptions);
    const input = continuation
      ? `در همین پروژه فقط تغییر زیر را اعمال کن. معماری Next.js و static export را حفظ کن، dependency جدید اضافه نکن، دستور npm install یا Build اجرا نکن و سؤال نپرس:\n\n${continuation}`
      : buildPrompt(await readFile(promptFile, "utf8"), await prepareInput(project.spec, workspace));
    let finalResponse = await streamCodexTurn(projectId, thread, input);
    await reportProgress(projectId, "generating", "تولید فایل‌ها کامل شد؛ آماده‌سازی برای Build…", "success");
    for (let repairAttempt = 0; ; repairAttempt += 1) {
      try {
        await updateProject(projectId, { status: "building", threadId: thread.id || project.threadId, finalResponse });
        await buildGeneratedSite(projectId, workspace);
        break;
      } catch (buildError) {
        if (repairAttempt >= 2) throw buildError;
        await reportProgress(projectId, "building", `Build ناموفق بود؛ ارسال خطا برای اصلاح خودکار (${repairAttempt + 1}/۲)…`, "error");
        const repairThreadId = thread.id || (await findProject(projectId))?.threadId;
        if (!repairThreadId) throw buildError;
        await updateProject(projectId, { status: "generating" });
        await reportProgress(projectId, "generating", "Codex در حال اصلاح خطاهای Build است…");
        thread = codex.resumeThread(repairThreadId, threadOptions);
        finalResponse = await streamCodexTurn(projectId, thread, `Build پروژه با خطاهای زیر ناموفق شد. فقط فایل‌های لازم را اصلاح کن. dependency جدید اضافه نکن و npm install یا Build اجرا نکن. سؤال نپرس.\n\n${buildFailureDetails(buildError)}`);
      }
    }
    await reportProgress(projectId, "ready", "پروژه با موفقیت آماده شد.", "success");
    await updateProject(projectId, { status: "ready", version: continuation ? project.version + 1 : 1, error: undefined });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await reportProgress(projectId, "failed", `فرایند متوقف شد: ${compact(message, 160)}`, "error").catch(() => undefined);
    await updateProject(projectId, { status: "failed", error: message }).catch(() => undefined);
  } finally {
    activeJobs.delete(projectId);
  }
}

export function queueGeneration(projectId: string, continuation?: string) {
  setImmediate(() => void runJob(projectId, continuation));
}

export function isJobActive(projectId: string) {
  return activeJobs.has(projectId);
}
