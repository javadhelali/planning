"use client";

import { Bot, FileText, FolderGit2, HardDrive, Loader2, PanelLeft, PencilLine, TerminalSquare, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { ReactNode, useEffect, useMemo, useState } from "react";

import { softBorder } from "@/app/utilities/tmux";
import { ProjectAiContext } from "@/app/utilities/project-ai-context";
import { useWorkspace, type ProjectKind } from "@/app/utilities/workspace-context";
import { ActionMenu, ActionMenuItem } from "@/components/site/action-menu";

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
  const { getProjectBySlug, loading, openTree, openEditProject, promptDeleteProject } = useWorkspace();
  const project = getProjectBySlug(slug);

  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null);
  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!(event.target as HTMLElement).closest("[data-action-menu-root]")) setOpenMenuKey(null);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

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
      {/* Mobile context bar — one row carries Browse, the project name, the tab
          switcher and an overflow menu, so the phone gives its height to the
          terminal instead of to four stacked toolbars. */}
      <div className="surface-card flex items-center gap-2 rounded-[16px] px-2 py-1.5 lg:hidden">
        <button type="button" onClick={openTree} aria-label="Browse servers and projects" title="Browse" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border" style={{ borderColor: softBorder, color: "var(--foreground-muted)" }}>
          <PanelLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <FolderGit2 className="h-4 w-4 shrink-0" style={{ color: "var(--accent)" }} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{project.name}</span>

        {project.server_id !== null ? (
          <div className="flex shrink-0 items-center gap-0.5 rounded-full p-0.5" style={{ backgroundColor: "color-mix(in srgb, var(--background-elevated) 88%, transparent)" }}>
            {tabs.map((entry) => {
              const Icon = entry.icon;
              return (
                <Link key={entry.id} href={entry.href} aria-label={entry.label} title={entry.label} className="inline-flex h-7 w-9 items-center justify-center rounded-full transition" style={entry.active ? { backgroundColor: "var(--accent-tint)", color: "var(--accent)" } : { color: "var(--foreground-muted)" }}>
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </Link>
              );
            })}
          </div>
        ) : null}

        <ActionMenu menuKey="project-actions" openMenuKey={openMenuKey} onToggle={(k) => setOpenMenuKey((c) => (c === k ? null : k))} adaptiveDirection>
          <ActionMenuItem onClick={() => { setOpenMenuKey(null); openEditProject(project); }}>
            <span className="inline-flex items-center gap-2"><PencilLine className="h-4 w-4" aria-hidden="true" /> Edit project</span>
          </ActionMenuItem>
          <ActionMenuItem tone="danger" onClick={() => { setOpenMenuKey(null); promptDeleteProject(project); }}>
            <span className="inline-flex items-center gap-2"><Trash2 className="h-4 w-4" aria-hidden="true" /> Delete project</span>
          </ActionMenuItem>
        </ActionMenu>
      </div>

      {/* Desktop project header + actions */}
      <div className="surface-card hidden flex-wrap items-center gap-x-3 gap-y-2 rounded-[20px] px-4 py-3 lg:flex">
        <FolderGit2 className="h-4 w-4 shrink-0" style={{ color: "var(--accent)" }} aria-hidden="true" />
        <span className="truncate text-sm font-semibold">{project.name}</span>
        <span className="inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium" style={kindTone(project.kind)}>{KIND_LABELS[project.kind]}</span>
        {project.root_path ? (
          <span className="inline-flex min-w-0 items-center gap-1 font-mono text-xs" style={{ color: "var(--foreground-muted)" }}>
            <HardDrive className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> <span className="truncate">{project.root_path}</span>
          </span>
        ) : null}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <button type="button" onClick={() => openEditProject(project)} className="inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium" style={{ borderColor: softBorder, color: "var(--foreground-muted)" }} title="Edit project">
            <PencilLine className="h-3.5 w-3.5" aria-hidden="true" /> Edit
          </button>
          <button type="button" onClick={() => promptDeleteProject(project)} className="inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium" style={{ borderColor: "color-mix(in srgb, var(--danger) 40%, transparent)", color: "var(--danger)" }} title="Delete project">
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Delete
          </button>
        </div>
      </div>

      {project.server_id === null ? (
        <div className="surface-subtle rounded-2xl px-4 py-3 text-sm" style={{ color: "var(--foreground-muted)" }}>
          This project isn’t pinned to a server yet. Edit it and set a server + root path to use terminals and AI.
        </div>
      ) : (
        <>
          {/* Desktop tabs */}
          <div className="hidden items-center gap-1.5 lg:flex">
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
