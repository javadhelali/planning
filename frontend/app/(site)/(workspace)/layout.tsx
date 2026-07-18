"use client";

import {
  ChevronDown,
  ChevronRight,
  FolderGit2,
  Loader2,
  PencilLine,
  Plus,
  Server as ServerIcon,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";

import { del, get, hasPlanningSession, post, put } from "../../utilities/api";
import { softBorder } from "../../utilities/tmux";
import {
  WorkspaceContext,
  type ProjectKind,
  type ToastKind,
  type WorkspaceContextValue,
  type WorkspaceProject,
  type WorkspaceServer,
} from "../../utilities/workspace-context";
import { ActionMenu, ActionMenuItem } from "@/components/site/action-menu";
import Modal from "@/components/site/modal";
import ToastStack from "@/components/site/toast-stack";

type AuthState = "checking" | "authenticated" | "guest";
type ToastMessage = { id: number; type: ToastKind; message: string };
type ServerModalState = { mode: "create" } | { mode: "edit"; server: WorkspaceServer } | null;
type ProjectModalState = { mode: "create"; presetServerId?: number } | { mode: "edit"; project: WorkspaceProject } | null;

const PROJECT_KINDS: Array<{ value: ProjectKind; label: string }> = [
  { value: "personal", label: "Personal" },
  { value: "startup", label: "Startup" },
  { value: "mvp", label: "MVP" },
  { value: "test", label: "Test" },
];

async function readError(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (typeof payload?.detail === "string") return payload.detail;
  return `Request failed (${response.status})`;
}

function GuestHome() {
  return (
    <div className="content-width mx-auto px-4 py-10 sm:px-6 sm:py-14">
      <section className="surface-card rounded-[28px] px-6 py-8 sm:px-8 sm:py-10">
        <span className="inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]" style={{ backgroundColor: "var(--accent-tint)", color: "var(--accent)" }}>
          Projects
        </span>
        <h1 className="mt-5 max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">Your servers, projects, terminals and AI agents — in one place.</h1>
        <p className="mt-4 max-w-xl text-base leading-7" style={{ color: "var(--foreground-muted)" }}>
          Sign in to browse every codebase your agents work in, drive its terminals, and talk to Claude.
        </p>
        <Link href="/login" className="button-primary mt-8 inline-flex rounded-full px-5 py-3 text-sm font-semibold">Sign in to your workspace</Link>
      </section>
    </div>
  );
}

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [authState, setAuthState] = useState<AuthState>("checking");

  const [servers, setServers] = useState<WorkspaceServer[]>([]);
  const [projects, setProjects] = useState<WorkspaceProject[]>([]);
  const [agentModels, setAgentModels] = useState<WorkspaceContextValue["agentModels"]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set());
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Modals
  const [serverModal, setServerModal] = useState<ServerModalState>(null);
  const [serverName, setServerName] = useState("");
  const [serverHost, setServerHost] = useState("");
  const [serverPort, setServerPort] = useState("22");
  const [serverUsername, setServerUsername] = useState("");
  const [serverKeyPath, setServerKeyPath] = useState("");
  const [serverPosition, setServerPosition] = useState("");
  const [serverSubmitting, setServerSubmitting] = useState(false);
  const [pendingDeleteServer, setPendingDeleteServer] = useState<WorkspaceServer | null>(null);
  const [deleteServerBusy, setDeleteServerBusy] = useState(false);

  const [projectModal, setProjectModal] = useState<ProjectModalState>(null);
  const [projectName, setProjectName] = useState("");
  const [projectFormServerId, setProjectFormServerId] = useState("");
  const [projectKind, setProjectKind] = useState<ProjectKind>("personal");
  const [projectRootPath, setProjectRootPath] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [projectPosition, setProjectPosition] = useState("");
  const [projectSubmitting, setProjectSubmitting] = useState(false);
  const [pendingDeleteProject, setPendingDeleteProject] = useState<WorkspaceProject | null>(null);
  const [deleteProjectBusy, setDeleteProjectBusy] = useState(false);

  const pushToast = useCallback((type: ToastKind, message: string) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, type, message }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 3500);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((current) => current.filter((toast) => toast.id !== id)), []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [serversRes, projectsRes, modelsRes] = await Promise.all([
        get("/planning/servers"),
        get("/planning/projects"),
        get("/planning/agent/models"),
      ]);
      if (!serversRes.ok) setError(await readError(serversRes));
      else {
        setServers(await serversRes.json());
        setError(null);
      }
      if (projectsRes.ok) setProjects(await projectsRes.json());
      if (modelsRes.ok) {
        const data = await modelsRes.json();
        setAgentModels(Array.isArray(data.models) ? data.models : []);
      }
    } catch {
      setError("Could not load your workspace.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setAuthState(hasPlanningSession() ? "authenticated" : "guest");
  }, []);

  useEffect(() => {
    if (authState === "authenticated") void refresh();
  }, [authState, refresh]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!(event.target as HTMLElement).closest("[data-action-menu-root]")) setOpenMenuKey(null);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  // Close the mobile drawer whenever the route changes (a selection was made).
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const projectsByServer = useMemo(() => {
    const map = new Map<number, WorkspaceProject[]>();
    for (const project of projects) {
      if (project.server_id === null) continue;
      const list = map.get(project.server_id) ?? [];
      list.push(project);
      map.set(project.server_id, list);
    }
    return map;
  }, [projects]);

  // --- modal openers --------------------------------------------------------

  const openCreateServer = useCallback(() => {
    setServerName(""); setServerHost(""); setServerPort("22"); setServerUsername(""); setServerKeyPath("");
    setServerModal({ mode: "create" });
  }, []);
  const openEditServer = useCallback((server: WorkspaceServer) => {
    setServerName(server.name); setServerHost(server.host); setServerPort(String(server.port));
    setServerUsername(server.username ?? ""); setServerKeyPath(server.key_path ?? "");
    setServerPosition(String(server.position));
    setServerModal({ mode: "edit", server });
  }, []);
  const openCreateProject = useCallback((serverId?: number) => {
    setProjectName(""); setProjectFormServerId(serverId ? String(serverId) : ""); setProjectKind("personal");
    setProjectRootPath(""); setProjectDescription("");
    setProjectModal({ mode: "create", presetServerId: serverId });
  }, []);
  const openEditProject = useCallback((project: WorkspaceProject) => {
    setProjectName(project.name); setProjectFormServerId(project.server_id ? String(project.server_id) : "");
    setProjectKind(project.kind); setProjectRootPath(project.root_path ?? ""); setProjectDescription(project.description ?? "");
    setProjectPosition(String(project.position));
    setProjectModal({ mode: "edit", project });
  }, []);

  // --- CRUD -----------------------------------------------------------------

  async function submitServer(event: FormEvent) {
    event.preventDefault();
    if (!serverModal) return;
    const body = {
      name: serverName.trim(),
      host: serverHost.trim(),
      port: Number.parseInt(serverPort, 10) || 22,
      username: serverUsername.trim() || null,
      key_path: serverKeyPath.trim() || null,
    };
    setServerSubmitting(true);
    try {
      const response = serverModal.mode === "create"
        ? await post("/planning/servers", body)
        : await put(`/planning/servers/${serverModal.server.id}`, { ...body, position: Number.parseInt(serverPosition, 10) || serverModal.server.position });
      if (!response.ok) { pushToast("error", await readError(response)); return; }
      pushToast("success", serverModal.mode === "create" ? "Server added." : "Server updated.");
      setServerModal(null);
      await refresh();
    } catch {
      pushToast("error", "Something went wrong. Please try again.");
    } finally {
      setServerSubmitting(false);
    }
  }

  async function confirmDeleteServer() {
    if (!pendingDeleteServer) return;
    setDeleteServerBusy(true);
    try {
      const response = await del(`/planning/servers/${pendingDeleteServer.id}`);
      if (!response.ok) { pushToast("error", await readError(response)); return; }
      pushToast("success", "Server removed.");
      setPendingDeleteServer(null);
      await refresh();
    } catch {
      pushToast("error", "Something went wrong. Please try again.");
    } finally {
      setDeleteServerBusy(false);
    }
  }

  async function submitProject(event: FormEvent) {
    event.preventDefault();
    if (!projectModal) return;
    const body = {
      name: projectName.trim(),
      server_id: projectFormServerId ? Number.parseInt(projectFormServerId, 10) : null,
      kind: projectKind,
      root_path: projectRootPath.trim() || null,
      description: projectDescription.trim() || null,
    };
    setProjectSubmitting(true);
    try {
      const response = projectModal.mode === "create"
        ? await post("/planning/projects", body)
        : await put(`/planning/projects/${projectModal.project.id}`, { ...body, position: Number.parseInt(projectPosition, 10) || projectModal.project.position });
      if (!response.ok) { pushToast("error", await readError(response)); return; }
      pushToast("success", projectModal.mode === "create" ? "Project added." : "Project updated.");
      setProjectModal(null);
      await refresh();
    } catch {
      pushToast("error", "Something went wrong. Please try again.");
    } finally {
      setProjectSubmitting(false);
    }
  }

  async function confirmDeleteProject() {
    if (!pendingDeleteProject) return;
    setDeleteProjectBusy(true);
    try {
      const response = await del(`/planning/projects/${pendingDeleteProject.id}`);
      if (!response.ok) { pushToast("error", await readError(response)); return; }
      pushToast("success", "Project removed.");
      setPendingDeleteProject(null);
      await refresh();
    } catch {
      pushToast("error", "Something went wrong. Please try again.");
    } finally {
      setDeleteProjectBusy(false);
    }
  }

  const contextValue: WorkspaceContextValue = useMemo(
    () => ({
      servers,
      projects,
      agentModels,
      loading,
      error,
      refresh,
      getProjectBySlug: (slug: string) => projects.find((p) => p.slug === slug) ?? null,
      getServer: (id: number) => servers.find((s) => s.id === id) ?? null,
      pushToast,
      openCreateServer,
      openEditServer,
      promptDeleteServer: setPendingDeleteServer,
      openCreateProject,
      openEditProject,
      promptDeleteProject: setPendingDeleteProject,
    }),
    [servers, projects, agentModels, loading, error, refresh, pushToast, openCreateServer, openEditServer, openCreateProject, openEditProject],
  );

  function toggleServer(id: number) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (authState === "checking") return <div className="skeleton h-64 rounded-[28px]" />;
  if (authState === "guest") return <GuestHome />;

  return (
    <WorkspaceContext.Provider value={contextValue}>
      <div className="flex h-full min-h-0 min-w-0 flex-col gap-3">
        <ToastStack toasts={toasts} onDismiss={dismissToast} />

        {mobileOpen ? (
          <button type="button" aria-label="Close navigation" className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setMobileOpen(false)} />
        ) : null}

        <div className="grid min-h-0 flex-1 gap-2 sm:gap-3 lg:grid-cols-[300px_minmax(0,1fr)]">
          {/* Workspace tree */}
          <aside
            className={`surface-card fixed inset-y-0 left-0 z-40 flex w-[280px] flex-col overflow-hidden rounded-none transition-transform duration-200 lg:static lg:z-auto lg:w-auto lg:translate-x-0 lg:rounded-[24px] ${
              mobileOpen ? "translate-x-0" : "-translate-x-full"
            }`}
          >
            <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5" style={{ borderColor: "color-mix(in srgb, var(--card-border) 60%, transparent)" }}>
              <span className="text-sm font-semibold">Workspace</span>
              <button type="button" onClick={openCreateServer} className="inline-flex h-8 items-center gap-1 rounded-full border px-2.5 text-xs font-medium" style={{ borderColor: softBorder, color: "var(--foreground-muted)" }} title="Add a server">
                <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Server
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto px-1.5 py-2">
              {loading && servers.length === 0 ? (
                <div className="flex items-center justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--foreground-muted)" }} aria-hidden="true" /></div>
              ) : error ? (
                <p className="px-2 py-2 text-xs" style={{ color: "var(--danger)" }}>{error}</p>
              ) : servers.length === 0 ? (
                <p className="px-2 py-2 text-xs" style={{ color: "var(--foreground-muted)" }}>No servers yet. Add one to begin.</p>
              ) : (
                servers.map((server) => {
                  const serverProjects = projectsByServer.get(server.id) ?? [];
                  const isCollapsed = collapsed.has(server.id);
                  const serverActive = pathname === `/servers/${server.id}`;
                  return (
                    <div key={server.id} className="mb-0.5">
                      <div className="group flex items-center gap-1 rounded-lg px-1 py-1">
                        <button type="button" onClick={() => toggleServer(server.id)} className="inline-flex h-5 w-5 shrink-0 items-center justify-center" title={isCollapsed ? "Expand" : "Collapse"}>
                          {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" style={{ color: "var(--foreground-muted)" }} aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5" style={{ color: "var(--foreground-muted)" }} aria-hidden="true" />}
                        </button>
                        <ServerIcon className="h-4 w-4 shrink-0" style={{ color: "var(--foreground-muted)" }} aria-hidden="true" />
                        <Link href={`/servers/${server.id}`} className="min-w-0 flex-1 truncate rounded px-1 py-0.5 text-left text-sm font-semibold" title={`${server.name} · ${server.host}`} style={serverActive ? { color: "var(--accent)" } : undefined}>
                          {server.name}
                        </Link>
                        <button type="button" onClick={() => openCreateProject(server.id)} className="row-action inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border" style={{ borderColor: softBorder, color: "var(--foreground-muted)" }} title={`Add a project on ${server.name}`}>
                          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <ActionMenu menuKey={`server-${server.id}`} openMenuKey={openMenuKey} onToggle={(k) => setOpenMenuKey((c) => (c === k ? null : k))} adaptiveDirection className="row-action">
                          <ActionMenuItem onClick={() => { setOpenMenuKey(null); openEditServer(server); }}>
                            <span className="inline-flex items-center gap-2"><PencilLine className="h-4 w-4" aria-hidden="true" /> Edit server</span>
                          </ActionMenuItem>
                          <ActionMenuItem tone="danger" onClick={() => { setOpenMenuKey(null); setPendingDeleteServer(server); }}>
                            <span className="inline-flex items-center gap-2"><Trash2 className="h-4 w-4" aria-hidden="true" /> Delete server</span>
                          </ActionMenuItem>
                        </ActionMenu>
                      </div>

                      {!isCollapsed ? (
                        serverProjects.length === 0 ? (
                          <button type="button" onClick={() => openCreateProject(server.id)} className="flex w-full items-center gap-1.5 rounded-lg py-1.5 pl-8 pr-2 text-left text-xs" style={{ color: "var(--foreground-muted)" }}>
                            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add a project
                          </button>
                        ) : (
                          serverProjects.map((project) => {
                            const active = pathname === `/projects/${project.slug}` || pathname.startsWith(`/projects/${project.slug}/`);
                            return (
                              <div key={project.id} className="group flex items-center gap-1 rounded-lg py-0.5 pl-6 pr-1" style={active ? { backgroundColor: "var(--accent-tint)" } : undefined}>
                                <FolderGit2 className="h-3.5 w-3.5 shrink-0" style={{ color: active ? "var(--accent)" : "var(--foreground-muted)" }} aria-hidden="true" />
                                <Link href={`/projects/${project.slug}`} className="min-w-0 flex-1 truncate rounded px-1 py-1 text-left text-xs font-medium" style={active ? { color: "var(--accent)" } : undefined} title={project.name}>
                                  {project.name}
                                </Link>
                                <ActionMenu menuKey={`project-${project.id}`} openMenuKey={openMenuKey} onToggle={(k) => setOpenMenuKey((c) => (c === k ? null : k))} adaptiveDirection className="row-action">
                                  <ActionMenuItem onClick={() => { setOpenMenuKey(null); openEditProject(project); }}>
                                    <span className="inline-flex items-center gap-2"><PencilLine className="h-4 w-4" aria-hidden="true" /> Edit</span>
                                  </ActionMenuItem>
                                  <ActionMenuItem tone="danger" onClick={() => { setOpenMenuKey(null); setPendingDeleteProject(project); }}>
                                    <span className="inline-flex items-center gap-2"><Trash2 className="h-4 w-4" aria-hidden="true" /> Delete</span>
                                  </ActionMenuItem>
                                </ActionMenu>
                              </div>
                            );
                          })
                        )
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </aside>

          {/* Main panel */}
          <div className="flex min-h-0 min-w-0 flex-col gap-2 sm:gap-3">
            <button type="button" onClick={() => setMobileOpen(true)} className="inline-flex h-8 w-fit shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium lg:hidden" style={{ borderColor: softBorder, color: "var(--foreground-muted)" }}>
              <ServerIcon className="h-3.5 w-3.5" aria-hidden="true" /> Browse
            </button>
            {children}
          </div>
        </div>

        {/* Server modal */}
        <Modal isOpen={serverModal !== null} onClose={() => !serverSubmitting && setServerModal(null)} title={serverModal?.mode === "edit" ? "Edit server" : "Add server"} description="Connection details for an SSH-reachable machine. Authentication is public-key only.">
          <form onSubmit={submitServer} className="space-y-4">
            <div>
              <label htmlFor="server-name" className="text-sm font-semibold">Name</label>
              <input id="server-name" value={serverName} onChange={(e) => setServerName(e.target.value)} className="field mt-2 rounded-2xl px-4 py-3 text-sm" placeholder="prod-box-1" required />
            </div>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px]">
              <div>
                <label htmlFor="server-host" className="text-sm font-semibold">Host / IP</label>
                <input id="server-host" value={serverHost} onChange={(e) => setServerHost(e.target.value)} className="field mt-2 rounded-2xl px-4 py-3 text-sm" placeholder="203.0.113.10" required />
              </div>
              <div>
                <label htmlFor="server-port" className="text-sm font-semibold">Port</label>
                <input id="server-port" type="number" min={1} max={65535} value={serverPort} onChange={(e) => setServerPort(e.target.value)} className="field mt-2 rounded-2xl px-4 py-3 text-sm" required />
              </div>
            </div>
            <div>
              <label htmlFor="server-username" className="text-sm font-semibold">SSH username</label>
              <input id="server-username" value={serverUsername} onChange={(e) => setServerUsername(e.target.value)} className="field mt-2 rounded-2xl px-4 py-3 text-sm" placeholder="ubuntu" />
            </div>
            <div>
              <label htmlFor="server-key-path" className="text-sm font-semibold">Private key path</label>
              <input id="server-key-path" value={serverKeyPath} onChange={(e) => setServerKeyPath(e.target.value)} className="field mt-2 rounded-2xl px-4 py-3 text-sm" placeholder="~/.ssh/id_ed25519 (blank = default key)" />
              <p className="mt-1.5 text-xs" style={{ color: "var(--foreground-muted)" }}>Path on the backend machine. Leave blank to use the default SSH key.</p>
            </div>
            {serverModal?.mode === "edit" ? (
              <div>
                <label htmlFor="server-position" className="text-sm font-semibold">Order</label>
                <input id="server-position" type="number" min={1} step={100} value={serverPosition} onChange={(e) => setServerPosition(e.target.value)} className="field mt-2 rounded-2xl px-4 py-3 text-sm" />
                <p className="mt-1.5 text-xs" style={{ color: "var(--foreground-muted)" }}>Lower numbers sort first. Servers are spaced by 100 — use a value in between (e.g. 150) to slot this one there.</p>
              </div>
            ) : null}
            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={() => setServerModal(null)} disabled={serverSubmitting} className="button-secondary rounded-2xl px-4 py-3 text-sm font-medium">Cancel</button>
              <button type="submit" disabled={serverSubmitting} className="button-primary rounded-2xl px-4 py-3 text-sm font-semibold">{serverSubmitting ? "Saving..." : serverModal?.mode === "edit" ? "Save server" : "Add server"}</button>
            </div>
          </form>
        </Modal>

        {/* Project modal */}
        <Modal isOpen={projectModal !== null} onClose={() => !projectSubmitting && setProjectModal(null)} title={projectModal?.mode === "edit" ? "Edit project" : "Add project"} description="A codebase agents can operate on. Pin it to a server and folder where it lives.">
          <form onSubmit={submitProject} className="space-y-4">
            <div>
              <label htmlFor="project-name" className="text-sm font-semibold">Name</label>
              <input id="project-name" value={projectName} onChange={(e) => setProjectName(e.target.value)} className="field mt-2 rounded-2xl px-4 py-3 text-sm" placeholder="trading" required />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="project-kind" className="text-sm font-semibold">Kind</label>
                <select id="project-kind" value={projectKind} onChange={(e) => setProjectKind(e.target.value as ProjectKind)} className="field mt-2 rounded-2xl px-4 py-3 text-sm">
                  {PROJECT_KINDS.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="project-server" className="text-sm font-semibold">Server</label>
                <select id="project-server" value={projectFormServerId} onChange={(e) => setProjectFormServerId(e.target.value)} className="field mt-2 rounded-2xl px-4 py-3 text-sm">
                  <option value="">No server</option>
                  {servers.map((server) => <option key={server.id} value={String(server.id)}>{server.name} ({server.host})</option>)}
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="project-root-path" className="text-sm font-semibold">Root path</label>
              <input id="project-root-path" value={projectRootPath} onChange={(e) => setProjectRootPath(e.target.value)} className="field mt-2 rounded-2xl px-4 py-3 text-sm" placeholder="/app/code/trading" />
            </div>
            <div>
              <label htmlFor="project-description" className="text-sm font-semibold">Description</label>
              <textarea id="project-description" value={projectDescription} onChange={(e) => setProjectDescription(e.target.value)} className="field mt-2 min-h-24 rounded-2xl px-4 py-3 text-sm" placeholder="Optional" />
            </div>
            {projectModal?.mode === "edit" ? (
              <div>
                <label htmlFor="project-position" className="text-sm font-semibold">Order</label>
                <input id="project-position" type="number" min={1} step={100} value={projectPosition} onChange={(e) => setProjectPosition(e.target.value)} className="field mt-2 rounded-2xl px-4 py-3 text-sm" />
                <p className="mt-1.5 text-xs" style={{ color: "var(--foreground-muted)" }}>Lower numbers sort first. Projects are spaced by 100 — use a value in between (e.g. 150) to slot this one there.</p>
              </div>
            ) : null}
            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={() => setProjectModal(null)} disabled={projectSubmitting} className="button-secondary rounded-2xl px-4 py-3 text-sm font-medium">Cancel</button>
              <button type="submit" disabled={projectSubmitting} className="button-primary rounded-2xl px-4 py-3 text-sm font-semibold">{projectSubmitting ? "Saving..." : projectModal?.mode === "edit" ? "Save project" : "Add project"}</button>
            </div>
          </form>
        </Modal>

        {/* Delete confirmations */}
        <Modal isOpen={pendingDeleteServer !== null} onClose={() => !deleteServerBusy && setPendingDeleteServer(null)} title="Remove server?" description="Projects on this server will be unlinked, not deleted.">
          <div className="space-y-4">
            <p className="text-sm leading-6" style={{ color: "var(--foreground-muted)" }}>{pendingDeleteServer ? `Remove server "${pendingDeleteServer.name}"?` : ""}</p>
            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={() => setPendingDeleteServer(null)} disabled={deleteServerBusy} className="button-secondary rounded-2xl px-4 py-3 text-sm font-medium">Cancel</button>
              <button type="button" onClick={() => void confirmDeleteServer()} disabled={deleteServerBusy} className="button-danger rounded-2xl px-4 py-3 text-sm font-semibold">{deleteServerBusy ? "Removing..." : "Remove server"}</button>
            </div>
          </div>
        </Modal>

        <Modal isOpen={pendingDeleteProject !== null} onClose={() => !deleteProjectBusy && setPendingDeleteProject(null)} title="Remove project?" description="This removes the selected project.">
          <div className="space-y-4">
            <p className="text-sm leading-6" style={{ color: "var(--foreground-muted)" }}>{pendingDeleteProject ? `Remove project "${pendingDeleteProject.name}"?` : ""}</p>
            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={() => setPendingDeleteProject(null)} disabled={deleteProjectBusy} className="button-secondary rounded-2xl px-4 py-3 text-sm font-medium">Cancel</button>
              <button type="button" onClick={() => void confirmDeleteProject()} disabled={deleteProjectBusy} className="button-danger rounded-2xl px-4 py-3 text-sm font-semibold">{deleteProjectBusy ? "Removing..." : "Remove project"}</button>
            </div>
          </div>
        </Modal>
      </div>
    </WorkspaceContext.Provider>
  );
}
