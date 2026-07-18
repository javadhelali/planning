"use client";

import { createContext, useContext } from "react";

// Per-project AI composer state that must survive switching between a project's
// AI / Terminals / Overview tabs. Provided by projects/[slug]/layout.tsx, keyed
// by slug so it resets when you move to a different project.
export type ProjectAiContextValue = {
  prompt: string;
  setPrompt: (value: string) => void;
  model: string;
  setModel: (value: string) => void;
  clear: boolean;
  setClear: (value: boolean) => void;
  lines: number;
  setLines: (value: number) => void;
};

export const ProjectAiContext = createContext<ProjectAiContextValue | null>(null);

export function useProjectAi(): ProjectAiContextValue {
  const value = useContext(ProjectAiContext);
  if (!value) throw new Error("useProjectAi must be used within a project layout");
  return value;
}
