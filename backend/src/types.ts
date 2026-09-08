export type BuildStatus = "draft" | "queued" | "generating" | "building" | "ready" | "failed";

export interface BuildProgressEvent {
  id: string;
  at: string;
  kind: "info" | "command" | "file" | "success" | "error";
  message: string;
}

export interface BuildProgress {
  stage: BuildStatus | "preparing" | "installing";
  message: string;
  model?: string;
  startedAt: string;
  lastActivityAt: string;
  events: BuildProgressEvent[];
}

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

export interface Project {
  id: string;
  userId: string;
  name: string;
  slug: string;
  spec: Record<string, unknown>;
  status: BuildStatus;
  continuationEnabled: boolean;
  threadId?: string;
  finalResponse?: string;
  error?: string;
  progress?: BuildProgress;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Database {
  users: User[];
  projects: Project[];
}

export type PublicProject = Omit<Project, "userId"> & {
  previewUrl: string | null;
  downloadUrl: string | null;
  localPath: string;
};
