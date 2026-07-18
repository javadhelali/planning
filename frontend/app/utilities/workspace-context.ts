"use client";

import { createContext, useContext } from "react";

import type { AgentModel } from "./tmux";

export type ProjectKind = "personal" | "startup" | "mvp" | "test";

export type WorkspaceServer = {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string | null;
  key_path: string | null;
  command: string | null;
  position: number;
};

export type WorkspaceProject = {
  id: number;
  server_id: number | null;
  name: string;
  slug: string;
  description: string | null;
  kind: ProjectKind;
  root_path: string | null;
  position: number;
  server_name: string | null;
  server_host: string | null;
};

export type ToastKind = "success" | "error";

// Shared, persistent workspace data + actions, provided by the (workspace) layout
// so it survives navigation between projects/servers/tabs (the tree never reloads).
export type WorkspaceContextValue = {
  servers: WorkspaceServer[];
  projects: WorkspaceProject[];
  agentModels: AgentModel[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  getProjectBySlug: (slug: string) => WorkspaceProject | null;
  getServer: (id: number) => WorkspaceServer | null;
  pushToast: (type: ToastKind, message: string) => void;
  openTree: () => void;
  openCreateServer: () => void;
  openEditServer: (server: WorkspaceServer) => void;
  promptDeleteServer: (server: WorkspaceServer) => void;
  openCreateProject: (serverId?: number) => void;
  openEditProject: (project: WorkspaceProject) => void;
  promptDeleteProject: (project: WorkspaceProject) => void;
};

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used within the workspace layout");
  return value;
}
