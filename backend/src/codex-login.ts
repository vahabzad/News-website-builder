import { spawn } from "node:child_process";
import { resolveCodexExecutable } from "./codex-executable.js";

const executable = await resolveCodexExecutable();
if (!executable) {
  console.error("Codex CLI پیدا نشد. ابتدا Codex Desktop یا Codex CLI را نصب کنید.");
  process.exit(1);
}

const credentialStore = ["--config", 'cli_auth_credentials_store="file"'];
const action = process.argv[2] === "status"
  ? [...credentialStore, "login", "status"]
  : [...credentialStore, "login"];
console.log(`Using local Codex: ${executable}`);
const child = spawn(executable, action, { stdio: "inherit", windowsHide: false });
child.on("exit", (code) => process.exit(code ?? 1));
child.on("error", (error) => { console.error(error.message); process.exit(1); });
