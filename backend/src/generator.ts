import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { Codex } from "@openai/codex-sdk";
import { resolveCodexExecutable } from "./codex-executable.js";
import { projectWorkspace, promptFile } from "./paths.js";
import { findProject, updateProject } from "./store.js";

const execFileAsync = promisify(execFile);
const activeJobs = new Set<string>();
const ALLOWED_DEPENDENCIES = new Set(["next", "react", "react-dom", "typescript", "@types/node", "@types/react", "@types/react-dom"]);
const FILE_CREDENTIAL_ARGS = ["--config", 'cli_auth_credentials_store="file"'];

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

async function buildGeneratedSite(workspace: string) {
  await validateGeneratedPackage(workspace);
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  await execFileAsync(npm, ["install", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: workspace, timeout: 8 * 60_000, maxBuffer: 2_000_000 });
  const nextBinary = path.join(workspace, "node_modules", ".bin", process.platform === "win32" ? "next.cmd" : "next");
  await execFileAsync(nextBinary, ["build", "--webpack"], { cwd: workspace, timeout: 8 * 60_000, maxBuffer: 3_000_000 });
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

async function runJob(projectId: string, continuation?: string) {
  if (activeJobs.has(projectId)) return;
  activeJobs.add(projectId);
  try {
    const project = await findProject(projectId);
    if (!project) throw new Error("پروژه پیدا نشد.");
    const workspace = projectWorkspace(projectId);
    if (!continuation) {
      await rm(workspace, {
        recursive: true,
        force: true,
        maxRetries: 8,
        retryDelay: 250,
      });
      await mkdir(workspace, { recursive: true });
      await execFileAsync("git", ["init", "--quiet"], { cwd: workspace, timeout: 15_000, windowsHide: true });
      await writeFile(path.join(workspace, "AGENTS.md"), projectInstructions(project.name), "utf8");
    }
    const login = await getLocalCodexStatus();
    if (!login.ready) throw new Error("Codex محلی وارد حساب ChatGPT نیست. در پوشه سایت‌ساز دستور npm run codex:login را اجرا کنید و سپس دوباره تلاش کنید.");
    await updateProject(projectId, { status: "generating", error: undefined });
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
      ...(process.env.CODEX_MODEL ? { model: process.env.CODEX_MODEL } : {}),
    };
    const thread = continuation && project.threadId ? codex.resumeThread(project.threadId, threadOptions) : codex.startThread(threadOptions);
    const input = continuation
      ? `در همین پروژه فقط تغییر زیر را اعمال کن. معماری Next.js و static export را حفظ کن، dependency جدید اضافه نکن و سؤال نپرس:\n\n${continuation}`
      : buildPrompt(await readFile(promptFile, "utf8"), await prepareInput(project.spec, workspace));
    const result = await thread.run(input);
    await updateProject(projectId, { status: "building", threadId: thread.id || project.threadId, finalResponse: result.finalResponse });
    await buildGeneratedSite(workspace);
    await updateProject(projectId, { status: "ready", version: continuation ? project.version + 1 : 1, error: undefined });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
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
