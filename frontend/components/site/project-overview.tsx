"use client";

import { FileText, FolderGit2, GitBranch, Loader2, RotateCw } from "lucide-react";

import { gitStatusColor, panelHeaderBorder, softBorder, type Project, type ProjectOverview } from "@/app/utilities/tmux";

// Project overview panel: the repo's AGENTS.md and its changed files (if a git repo).
export default function ProjectOverviewPanel({
  project,
  overview,
  loading,
  error,
  onRefresh,
}: {
  project: Project | null;
  overview: ProjectOverview | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  return (
    <section className="surface-card flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[24px]">
      <div className="flex items-center gap-2 border-b px-4 py-2.5" style={panelHeaderBorder}>
        <FolderGit2 className="h-4 w-4 shrink-0" style={{ color: "var(--accent)" }} aria-hidden="true" />
        <span className="shrink-0 text-sm font-semibold">{project?.name ?? "Project"}</span>
        {project?.root_path ? <span className="min-w-0 truncate font-mono text-xs" style={{ color: "var(--foreground-muted)" }}>{project.root_path}</span> : null}
        <button
          type="button"
          onClick={onRefresh}
          className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-full border"
          style={{ borderColor: softBorder, color: "var(--foreground-muted)" }}
          title="Refresh overview"
        >
          <RotateCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {loading && !overview ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-7 w-7 animate-spin" style={{ color: "var(--foreground-muted)" }} aria-hidden="true" />
          </div>
        ) : error ? (
          <p className="text-sm" style={{ color: "var(--danger)" }}>{error}</p>
        ) : !overview ? null : !overview.has_root ? (
          <p className="text-sm" style={{ color: "var(--foreground-muted)" }}>
            No root path set for this project. Add one to see its AGENTS.md and git changes.
          </p>
        ) : (
          <div className="space-y-6">
            {/* AGENTS.md */}
            <div>
              <h3 className="mb-2 inline-flex items-center gap-2 text-sm font-semibold">
                <FileText className="h-4 w-4" style={{ color: "var(--accent)" }} aria-hidden="true" /> AGENTS.md
              </h3>
              {overview.agents_md ? (
                <pre
                  className="max-h-[46vh] overflow-auto whitespace-pre-wrap rounded-xl border p-3 text-xs leading-5"
                  style={{ borderColor: softBorder, fontFamily: "var(--font-mono)" }}
                >
                  {overview.agents_md}
                </pre>
              ) : (
                <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>No AGENTS.md in the project root.</p>
              )}
            </div>

            {/* Git changes */}
            <div>
              <h3 className="mb-2 inline-flex items-center gap-2 text-sm font-semibold">
                <GitBranch className="h-4 w-4" style={{ color: "var(--accent)" }} aria-hidden="true" /> Changed files
                {overview.is_git ? <span className="text-xs font-normal" style={{ color: "var(--foreground-muted)" }}>({overview.changed_files.length})</span> : null}
              </h3>
              {!overview.is_git ? (
                <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>Not a git repository.</p>
              ) : overview.changed_files.length === 0 ? (
                <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>Working tree clean.</p>
              ) : (
                <ul className="divide-y overflow-hidden rounded-xl border" style={{ borderColor: softBorder }}>
                  {overview.changed_files.map((file) => (
                    <li key={file.path} className="flex items-center gap-2 px-3 py-1.5">
                      <span className="w-6 shrink-0 text-center font-mono text-[11px] font-bold" style={{ color: gitStatusColor(file.status) }}>{file.status}</span>
                      <span className="min-w-0 flex-1 truncate font-mono text-xs" title={file.path}>{file.path}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
