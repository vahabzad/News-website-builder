import "dotenv/config";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import archiver from "archiver";
import bcrypt from "bcryptjs";
import cors from "cors";
import express, { type Response } from "express";
import rateLimit from "express-rate-limit";
import { fileTypeFromBuffer } from "file-type";
import helmet from "helmet";
import multer from "multer";
import { nanoid } from "nanoid";
import slugify from "slugify";
import { createToken, requireAuth, type AuthRequest } from "./auth.js";
import { getLocalCodexStatus, queueGeneration } from "./generator.js";
import { projectPublicOutput, projectWorkspace, storageRoot, workspaceRoot } from "./paths.js";
import { authSchema, continuationSchema, siteSpecSchema } from "./schemas.js";
import { findProject, findUserByEmail, readDatabase, updateDatabase, updateProject } from "./store.js";
import type { Project, PublicProject } from "./types.js";

const app = express();
const port = Number(process.env.PORT || 4000);
const allowedOrigins = (process.env.FRONTEND_ORIGIN || "http://localhost:3000")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const continuationGloballyEnabled = process.env.ALLOW_CONTINUATION !== "false";
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

await Promise.all([mkdir(storageRoot, { recursive: true }), mkdir(workspaceRoot, { recursive: true })]);

app.disable("x-powered-by");
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  // The generated preview is intentionally embedded by the configured frontend.
  // X-Frame-Options cannot express different ports, so CSP controls this instead.
  xFrameOptions: false,
  contentSecurityPolicy: {
    directives: {
      frameAncestors: ["'self'", ...allowedOrigins],
    },
  },
}));
app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: "256kb" }));
app.use("/api/auth", rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false }));

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "news-builder-backend", continuationEnabled: continuationGloballyEnabled }));
app.get("/api/codex/status", async (_req, res) => res.json(await getLocalCodexStatus()));

app.post("/api/auth/register", async (req, res) => {
  const parsed = authSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "ایمیل معتبر و رمز عبور حداقل ۸ کاراکتری وارد کنید." });
  if (await findUserByEmail(parsed.data.email)) return res.status(409).json({ message: "این ایمیل قبلاً ثبت شده است." });
  const user = { id: nanoid(), email: parsed.data.email, passwordHash: await bcrypt.hash(parsed.data.password, 12), createdAt: new Date().toISOString() };
  await updateDatabase((db) => db.users.push(user));
  res.status(201).json({ token: createToken(user.id), user: { id: user.id, email: user.email } });
});

app.post("/api/auth/login", async (req, res) => {
  const parsed = authSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "اطلاعات ورود معتبر نیست." });
  const user = await findUserByEmail(parsed.data.email);
  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) return res.status(401).json({ message: "ایمیل یا رمز عبور اشتباه است." });
  res.json({ token: createToken(user.id), user: { id: user.id, email: user.email } });
});

function publicProject(project: Project): PublicProject {
  const ready = project.status === "ready";
  const error = project.error && /api\.openai\.com|stream disconnected/i.test(project.error)
    ? "نشست محلی Codex در دسترس نیست. ابتدا در پوشه سایت‌ساز npm run codex:login را اجرا کنید و سپس «تلاش مجدد» را بزنید."
    : project.error;
  return { ...project, error, previewUrl: ready ? `/preview/${project.id}/` : null, downloadUrl: ready ? `/api/projects/${project.id}/download` : null, localPath: projectWorkspace(project.id) };
}

const previewTextExtensions = new Set([".html", ".css", ".js", ".json", ".txt"]);

function rewritePreviewPaths(content: string, prefix: string) {
  return content
    // HTML attributes, JavaScript strings, and serialized Next.js payloads.
    .replace(/(["'])\/(?!\/)/g, `$1${prefix}/`)
    // Root-relative URLs inside stylesheets.
    .replace(/url\(\s*(["']?)\/(?!\/)/g, `url($1${prefix}/`);
}

async function sendPreviewFile(res: Response, target: string, prefix: string) {
  const extension = path.extname(target).toLowerCase();
  if (!previewTextExtensions.has(extension)) {
    res.sendFile(target);
    return;
  }
  const content = await readFile(target, "utf8");
  res.type(extension).send(rewritePreviewPaths(content, prefix));
}

async function ownedProject(req: AuthRequest, res: Response) {
  const rawId = req.params.id;
  const project = await findProject(Array.isArray(rawId) ? rawId[0] : rawId);
  if (!project || project.userId !== req.userId) { res.status(404).json({ message: "پروژه پیدا نشد." }); return null; }
  return project;
}

app.get("/api/projects", requireAuth, async (req: AuthRequest, res) => {
  const projects = (await readDatabase()).projects.filter((item) => item.userId === req.userId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(publicProject);
  res.json({ projects });
});

app.post("/api/projects", requireAuth, async (req: AuthRequest, res) => {
  const parsed = siteSpecSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "اطلاعات فرم کامل یا معتبر نیست.", issues: parsed.error.issues });
  const now = new Date().toISOString();
  const project: Project = { id: nanoid(12), userId: req.userId!, name: parsed.data.siteName, slug: slugify(parsed.data.siteName, { lower: true, strict: true }) || nanoid(7), spec: parsed.data, status: "draft", continuationEnabled: continuationGloballyEnabled, version: 0, createdAt: now, updatedAt: now };
  await updateDatabase((db) => db.projects.push(project));
  res.status(201).json(publicProject(project));
});

app.get("/api/projects/:id", requireAuth, async (req: AuthRequest, res) => { const project = await ownedProject(req, res); if (project) res.json(publicProject(project)); });

app.post("/api/projects/:id/logo", requireAuth, upload.single("logo"), async (req: AuthRequest, res) => {
  const project = await ownedProject(req, res); if (!project) return;
  if (!req.file) return res.status(400).json({ message: "فایل لوگو ارسال نشده است." });
  const type = await fileTypeFromBuffer(req.file.buffer);
  const allowed = new Map([["image/png", "png"], ["image/jpeg", "jpg"], ["image/webp", "webp"]]);
  const extension = type ? allowed.get(type.mime) : undefined;
  if (!extension) return res.status(415).json({ message: "فقط PNG، JPEG و WebP مجاز است." });
  const folder = path.join(storageRoot, project.id); await mkdir(folder, { recursive: true });
  const filename = `logo-${nanoid(12)}.${extension}`; await writeFile(path.join(folder, filename), req.file.buffer, { flag: "wx" });
  project.spec = { ...project.spec, uploadedLogo: path.join(folder, filename) };
  await updateProject(project.id, { spec: project.spec });
  res.status(201).json({ uploaded: true });
});

app.post("/api/projects/:id/generate", requireAuth, async (req: AuthRequest, res) => {
  const project = await ownedProject(req, res); if (!project) return;
  if (["queued", "generating", "building"].includes(project.status)) return res.status(409).json({ message: "این پروژه هم‌اکنون در حال ساخت است." });
  await updateProject(project.id, { status: "queued", error: undefined }); queueGeneration(project.id); res.status(202).json({ queued: true });
});

app.post("/api/projects/:id/continue", requireAuth, async (req: AuthRequest, res) => {
  const project = await ownedProject(req, res); if (!project) return;
  if (!continuationGloballyEnabled || !project.continuationEnabled) return res.status(403).json({ message: "امکان ادامه پروژه فعلاً غیرفعال است." });
  if (project.status !== "ready" || !project.threadId) return res.status(409).json({ message: "پروژه هنوز آماده ادامه نیست." });
  const parsed = continuationSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ message: "دستور تغییر معتبر نیست." });
  await updateProject(project.id, { status: "queued", error: undefined }); queueGeneration(project.id, parsed.data.instruction); res.status(202).json({ queued: true });
});

app.get("/api/projects/:id/download", requireAuth, async (req: AuthRequest, res) => {
  const project = await ownedProject(req, res); if (!project) return;
  if (project.status !== "ready") return res.status(409).json({ message: "خروجی پروژه هنوز آماده نیست." });
  res.attachment(`${project.slug || "news-site"}.zip`);
  const archive = archiver("zip", { zlib: { level: 9 } }); archive.on("error", (error) => res.destroy(error)); archive.pipe(res);
  archive.glob("**/*", { cwd: projectWorkspace(project.id), ignore: ["node_modules/**", ".next/**", "out/**", ".git/**"] }); await archive.finalize();
});

app.use("/preview/:id", async (req, res) => {
  const rawId = req.params.id;
  const project = await findProject(Array.isArray(rawId) ? rawId[0] : rawId);
  if (!project || project.status !== "ready") return res.status(404).send("Preview is not ready");
  const root = path.resolve(projectPublicOutput(project.id));
  const previewPrefix = `/preview/${encodeURIComponent(project.id)}`;
  // Keep framing restricted to the configured frontends, while allowing the
  // generated app's own inline Next.js bootstrap scripts to run.
  res.setHeader("Content-Security-Policy", `frame-ancestors 'self' ${allowedOrigins.join(" ")}`);
  let relative = decodeURIComponent(req.path).replace(/^\/+/, "");
  if (!relative || relative.endsWith("/")) relative += "index.html";
  let target = path.resolve(root, relative);
  if (!target.startsWith(`${root}${path.sep}`) && target !== root) return res.status(403).send("Forbidden");
  try { if ((await stat(target)).isDirectory()) target = path.join(target, "index.html"); await stat(target); await sendPreviewFile(res, target, previewPrefix); }
  catch { try { const fallback = path.join(root, relative, "index.html"); await stat(fallback); await sendPreviewFile(res, fallback, previewPrefix); } catch { res.status(404).send("Not found"); } }
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof multer.MulterError) return res.status(400).json({ message: error.code === "LIMIT_FILE_SIZE" ? "حجم فایل نباید بیشتر از ۵ مگابایت باشد." : "آپلود فایل نامعتبر است." });
  console.error(error); res.status(500).json({ message: "خطای داخلی سرور" });
});

app.listen(port, () => console.log(`News builder API: http://localhost:${port}`));
