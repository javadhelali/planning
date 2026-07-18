"use client";

import { Bot, FileText, FolderGit2, HardDrive, Loader2, PencilLine, TerminalSquare, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { ReactNode, useMemo, useState } from "react";

import { softBorder } from "@/app/utilities/tmux";
import { ProjectAiContext } from "@/app/utilities/project-ai-context";
import { useWorkspace, type ProjectKind } from "@/app/utilities/workspace-context";

const DEFAULT_AGENT_LINES = 50;

const KIND_LABELS: Record<ProjectKind, string> = { personal: "Personal", startup: "Startup", mvp: "MVP", test: "Test" };

function kindTone(kind: ProjectKind): { background: string; color: string } {
  switch (kind) {
    case "startup":
      return { background: "color-mix(in srgb, var(--accent-tint) 74%, transparent)", color: "var(--accent)" };
    case "mvp":
      return { background: "color-mix(in srgb, var(--danger-tint) 60%, transparent)", color: "var(--danger)" };
    case "test":
      return { background: "color-mix(in srgb, var(--background-elevated) 86%, transparent)", color: "var(--foreground-muted)" };
    default:
      return { background: "color-mix(in srgb, var(--background-elevated) 86%, transparent)", color: "var(--foreground)" };
  }
}

// Holds the per-project AI composer state. Keyed by slug in the layout, so it
// persists across this project's AI/Terminals/Overview tabs but resets when you
// switch to another project.
function ProjectAiProvider({ children }: { children: ReactNode }) {
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("");
  const [clear, setClear] = useState(false);
  const [lines, setLines] = useState(DEFAULT_AGENT_LINES);
  const value = useMemo(
    () => ({ prompt, setPrompt, model, setModel, clear, setClear, lines, setLines }),
    [prompt, model, clear, lines],
  );
  return <ProjectAiContext.Provider value={value}>{children}</ProjectAiContext.Provider>;
}

export default function ProjectLayout({ children }: { children: ReactNode }) {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const pathname = usePathname();
  const { getProjectBySlug, loading, openEditProject, promptDeleteProject } = useWorkspace();
  const project = getProjectBySlug(slug);

  if (!project) {
    return (
      <div className="surface-card flex min-h-0 flex-1 items-center justify-center rounded-[24px] py-16">
        {loading ? (
          <Loader2 className="h-8 w-8 animate-spin" style={{ color: "var(--foreground-muted)" }} aria-hidden="true" />
        ) : (
          <p className="text-sm" style={{ color: "var(--foreground-muted)" }}>Project not found.</p>
        )}
      </div>
    );
  }

  const base = `/projects/${slug}`;
  const tabs = [
    { id: "ai", label: "AI", icon: Bot, href: base, active: pathname === base },
    { id: "terminals", label: "Terminals", icon: TerminalSquare, href: `${base}/terminals`, active: pathname === `${base}/terminals` },
    { id: "overview", label: "Overview", icon: FileText, href: `${base}/overview`, active: pathname === `${base}/overview` },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 sm:gap-3">
      {/* Project header + actions */}
      <div className="surface-card flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[20px] px-3 py-2.5 sm:px-4 sm:py-3">
        <FolderGit2 className="h-4 w-4 shrink-0" style={{ color: "var(--accent)" }} aria-hidden="true" />
        <span className="truncate text-sm font-semibold">{project.name}</span>
        <span className="inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium" style={kindTone(project.kind)}>{KIND_LABELS[project.kind]}</span>
        {project.root_path ? (
          <span className="hidden min-w-0 items-center gap-1 font-mono text-xs sm:inline-flex" style={{ color: "var(--foreground-muted)" }}>
            <HardDrive className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> <span className="truncate">{project.root_path}</span>
          </span>
        ) : null}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <button type="button" onClick={() => openEditProject(project)} className="inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium sm:px-3" style={{ borderColor: softBorder, color: "var(--foreground-muted)" }} title="Edit project">
            <PencilLine className="h-3.5 w-3.5" aria-hidden="true" /> <span className="hidden sm:inline">Edit</span>
          </button>
          <button type="button" onClick={() => promptDeleteProject(project)} className="inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium sm:px-3" style={{ borderColor: "color-mix(in srgb, var(--danger) 40%, transparent)", color: "var(--danger)" }} title="Delete project">
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> <span className="hidden sm:inline">Delete</span>
          </button>
        </div>
      </div>

      {project.server_id === null ? (
        <div className="surface-subtle rounded-2xl px-4 py-3 text-sm" style={{ color: "var(--foreground-muted)" }}>
          This project isn’t pinned to a server yet. Edit it and set a server + root path to use terminals and AI.
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div className="flex items-center gap-1.5">
            {tabs.map((entry) => {
              const Icon = entry.icon;
              return (
                <Link
                  key={entry.id}
                  href={entry.href}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition"
                  style={entry.active ? { borderColor: "var(--accent)", backgroundColor: "var(--accent-tint)", color: "var(--accent)" } : { borderColor: softBorder, color: "var(--foreground-muted)" }}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {entry.label}
                </Link>
              );
            })}
          </div>

          {/* Active tab */}
          <div className="flex min-h-0 flex-1 flex-col">
            <ProjectAiProvider key={slug}>{children}</ProjectAiProvider>
          </div>
        </>
      )}
    </div>
  );
}
