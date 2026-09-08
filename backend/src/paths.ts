import path from "node:path";
import { fileURLToPath } from "node:url";

const sourceDir = path.dirname(fileURLToPath(import.meta.url));
export const backendRoot = path.resolve(sourceDir, "..");
export const workspaceRoot = path.join(backendRoot, "workspaces");
export const storageRoot = path.join(backendRoot, "storage");
export const dataRoot = path.join(backendRoot, "data");
export const databaseFile = path.join(dataRoot, "database.json");
export const promptFile = path.resolve(backendRoot, "..", "پرامت طراحی سایت.txt");

export function projectWorkspace(projectId: string) {
  return path.join(workspaceRoot, projectId);
}

export function projectPublicOutput(projectId: string) {
  return path.join(projectWorkspace(projectId), "out");
}
