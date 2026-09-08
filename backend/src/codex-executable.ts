import { access, readdir, stat } from "node:fs/promises";
import path from "node:path";

async function existing(file: string | undefined) {
  if (!file) return null;
  try { await access(file); return file; } catch { return null; }
}

async function desktopCandidates() {
  const local = process.env.LOCALAPPDATA;
  if (!local) return [];
  const binRoot = path.join(local, "OpenAI", "Codex", "bin");
  try {
    const entries = await readdir(binRoot, { withFileTypes: true });
    const candidates = entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(binRoot, entry.name, "codex.exe"));
    const withTime = await Promise.all(candidates.map(async (file) => {
      try { return { file, modified: (await stat(file)).mtimeMs }; } catch { return null; }
    }));
    return withTime.filter((item): item is { file: string; modified: number } => Boolean(item)).sort((a, b) => b.modified - a.modified).map((item) => item.file);
  } catch { return []; }
}

export async function resolveCodexExecutable() {
  const local = process.env.LOCALAPPDATA;
  const roaming = process.env.APPDATA;
  const candidates = [
    process.env.CODEX_PATH,
    local ? path.join(local, "Programs", "OpenAI", "Codex", "bin", "codex.exe") : undefined,
    roaming ? path.join(roaming, "npm", "codex.cmd") : undefined,
    "C:\\Program Files\\nodejs\\codex.cmd",
    ...(await desktopCandidates()),
  ];
  for (const candidate of candidates) {
    const found = await existing(candidate);
    if (found) return found;
  }
  return null;
}
