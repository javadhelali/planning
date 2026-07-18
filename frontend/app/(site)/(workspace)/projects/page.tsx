"use client";

import { FolderGit2, Plus } from "lucide-react";

import { softBorder } from "@/app/utilities/tmux";
import { useWorkspace } from "@/app/utilities/workspace-context";

// The /projects entry point. No auto-redirect — pick a project from the tree on
// the left, or create your first server/project here.
export default function ProjectsIndexPage() {
  const { projects, openCreateServer, openCreateProject } = useWorkspace();
  const hasProjects = projects.length > 0;

  return (
    <div className="surface-card flex min-h-0 flex-1 flex-col items-center justify-center rounded-[24px] px-6 py-16 text-center">
      <FolderGit2 className="h-9 w-9" style={{ color: "var(--foreground-muted)" }} aria-hidden="true" />
      <p className="mt-3 text-sm" style={{ color: "var(--foreground-muted)" }}>
        {hasProjects ? "Select a project from the left to open its AI, terminals and overview." : "No projects yet. Add your first server and project to get started."}
      </p>
      {!hasProjects ? (
        <div className="mt-4 flex items-center gap-2">
          <button type="button" onClick={openCreateServer} className="inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium" style={{ borderColor: softBorder, color: "var(--foreground-muted)" }}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Add server
          </button>
          <button type="button" onClick={() => openCreateProject()} className="button-primary inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-semibold">
            <Plus className="h-4 w-4" aria-hidden="true" /> Add project
          </button>
        </div>
      ) : null}
    </div>
  );
}
