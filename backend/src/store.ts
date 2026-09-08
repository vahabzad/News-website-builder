import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { nanoid } from "nanoid";
import { dataRoot, databaseFile } from "./paths.js";
import type { BuildProgress, Database, Project, User } from "./types.js";

let writeChain = Promise.resolve();

async function ensureDatabase() {
  await mkdir(dataRoot, { recursive: true });
  try {
    await readFile(databaseFile, "utf8");
  } catch {
    await writeFile(databaseFile, JSON.stringify({ users: [], projects: [] }, null, 2), "utf8");
  }
}

export async function readDatabase(): Promise<Database> {
  await ensureDatabase();
  return JSON.parse(await readFile(databaseFile, "utf8")) as Database;
}

async function persist(db: Database) {
  const temp = `${databaseFile}.${nanoid(6)}.tmp`;
  await writeFile(temp, JSON.stringify(db, null, 2), "utf8");
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(temp, databaseFile);
      return;
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      if (!["EBUSY", "EPERM", "EACCES"].includes(code) || attempt >= 9) throw error;
      await delay(50 * (attempt + 1));
    }
  }
}

export function updateDatabase<T>(mutate: (db: Database) => T | Promise<T>): Promise<T> {
  const operation = writeChain.then(async () => {
    const db = await readDatabase();
    const result = await mutate(db);
    await persist(db);
    return result;
  });
  writeChain = operation.then(() => undefined, () => undefined);
  return operation;
}

export async function findUserByEmail(email: string): Promise<User | undefined> {
  return (await readDatabase()).users.find((user) => user.email === email.toLowerCase());
}

export async function findProject(projectId: string): Promise<Project | undefined> {
  return (await readDatabase()).projects.find((project) => project.id === projectId);
}

export async function updateProject(projectId: string, patch: Partial<Project>): Promise<Project> {
  return updateDatabase((db) => {
    const project = db.projects.find((item) => item.id === projectId);
    if (!project) throw new Error("PROJECT_NOT_FOUND");
    Object.assign(project, patch, { updatedAt: new Date().toISOString() });
    return structuredClone(project);
  });
}

export async function updateProjectProgress(projectId: string, mutate: (progress: BuildProgress | undefined) => BuildProgress): Promise<Project> {
  return updateDatabase((db) => {
    const project = db.projects.find((item) => item.id === projectId);
    if (!project) throw new Error("PROJECT_NOT_FOUND");
    project.progress = mutate(project.progress);
    project.updatedAt = new Date().toISOString();
    return structuredClone(project);
  });
}
