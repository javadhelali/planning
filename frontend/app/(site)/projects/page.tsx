"use client";

import {
  FolderGit2,
  Globe,
  HardDrive,
  KeyRound,
  PencilLine,
  Plus,
  Server as ServerIcon,
  Terminal,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";

import { del, get, hasPlanningSession, post, put } from "../../utilities/api";
import { ActionMenu, ActionMenuItem } from "@/components/site/action-menu";
import MetaItem from "@/components/site/meta-item";
import Modal from "@/components/site/modal";
import ToastStack from "@/components/site/toast-stack";

type AuthState = "checking" | "authenticated" | "guest";
type ProjectKind = "personal" | "startup" | "mvp" | "test";

type Server = {
  id: number;
  user_id: number;
  name: string;
  host: string;
  port: number;
  username: string | null;
  key_path: string | null;
  position: number;
  created_at: string;
  updated_at: string;
};

type Project = {
  id: number;
  user_id: number;
  server_id: number | null;
  name: string;
  description: string | null;
  kind: ProjectKind;
  root_path: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  server_name: string | null;
  server_host: string | null;
};

type ToastMessage = {
  id: number;
  type: "success" | "error";
  message: string;
};

type ServerModalState =
  | { mode: "create" }
  | { mode: "edit"; server: Server }
  | null;

type ProjectModalState =
  | { mode: "create" }
  | { mode: "edit"; project: Project }
  | null;

type PendingConfirmation =
  | { kind: "delete_server"; server: Server }
  | { kind: "delete_project"; project: Project }
  | null;

const PROJECT_KINDS: Array<{ value: ProjectKind; label: string }> = [
  { value: "personal", label: "Personal" },
  { value: "startup", label: "Startup" },
  { value: "mvp", label: "MVP" },
  { value: "test", label: "Test" },
];

const KIND_LABELS: Record<ProjectKind, string> = {
  personal: "Personal",
  startup: "Startup",
  mvp: "MVP",
  test: "Test",
};

async function readErrorMessage(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (typeof payload?.detail === "string") return payload.detail;
  return `Request failed (${response.status})`;
}

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

function GuestHome() {
  return (
    <div className="content-width mx-auto px-4 py-10 sm:px-6 sm:py-14">
      <main className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <section className="surface-card rounded-[28px] px-6 py-8 sm:px-8 sm:py-10">
          <span
            className="inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]"
            style={{ backgroundColor: "var(--accent-tint)", color: "var(--accent)" }}
          >
            Projects
          </span>
          <h1 className="mt-5 max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
            Register your servers and the projects that live on them.
          </h1>
          <p className="mt-4 max-w-xl text-base leading-7" style={{ color: "var(--foreground-muted)" }}>
            Keep a single source of truth for every machine you run agents on and every codebase they operate in — the
            groundwork for remote agent sessions.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/login" className="button-primary rounded-full px-5 py-3 text-sm font-semibold">
              Sign in to your workspace
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-3">
      <div className="skeleton h-10 w-44 rounded-2xl" />
      <div className="skeleton h-28 rounded-[28px]" />
      <div className="skeleton h-28 rounded-[28px]" />
    </div>
  );
}

export default function ProjectsPage() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [isLoading, setIsLoading] = useState(true);
  const [servers, setServers] = useState<Server[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null);

  const [serverModal, setServerModal] = useState<ServerModalState>(null);
  const [serverName, setServerName] = useState("");
  const [serverHost, setServerHost] = useState("");
  const [serverPort, setServerPort] = useState("22");
  const [serverUsername, setServerUsername] = useState("");
  const [serverKeyPath, setServerKeyPath] = useState("");
  const [isServerSubmitting, setIsServerSubmitting] = useState(false);

  const [projectModal, setProjectModal] = useState<ProjectModalState>(null);
  const [projectName, setProjectName] = useState("");
  const [projectServerId, setProjectServerId] = useState<string>("");
  const [projectKind, setProjectKind] = useState<ProjectKind>("personal");
  const [projectRootPath, setProjectRootPath] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [isProjectSubmitting, setIsProjectSubmitting] = useState(false);

  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation>(null);
  const [isConfirmationBusy, setIsConfirmationBusy] = useState(false);

  const pushToast = useCallback((type: ToastMessage["type"], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, type, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4000);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [serversRes, projectsRes] = await Promise.all([get("/planning/servers"), get("/planning/projects")]);
      if (serversRes.ok) {
        setServers(await serversRes.json());
      }
      if (projectsRes.ok) {
        setProjects(await projectsRes.json());
      }
    } catch {
      pushToast("error", "Could not load projects and servers.");
    } finally {
      setIsLoading(false);
    }
  }, [pushToast]);

  useEffect(() => {
    setAuthState(hasPlanningSession() ? "authenticated" : "guest");
  }, []);

  useEffect(() => {
    if (authState !== "authenticated") return;
    void loadData();
  }, [authState, loadData]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest("[data-action-menu-root]")) {
        setOpenMenuKey(null);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const toggleMenu = useCallback((menuKey: string) => {
    setOpenMenuKey((current) => (current === menuKey ? null : menuKey));
  }, []);

  // ---- Server modal helpers -------------------------------------------------

  function openCreateServer() {
    setServerName("");
    setServerHost("");
    setServerPort("22");
    setServerUsername("");
    setServerKeyPath("");
    setServerModal({ mode: "create" });
  }

  function openEditServer(server: Server) {
    setServerName(server.name);
    setServerHost(server.host);
    setServerPort(String(server.port));
    setServerUsername(server.username ?? "");
    setServerKeyPath(server.key_path ?? "");
    setServerModal({ mode: "edit", server });
  }

  function closeServerModal() {
    if (isServerSubmitting) return;
    setServerModal(null);
  }

  async function handleSubmitServer(event: FormEvent) {
    event.preventDefault();
    if (!serverModal) return;

    const parsedPort = Number.parseInt(serverPort, 10);
    if (Number.isNaN(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      pushToast("error", "Port must be between 1 and 65535.");
      return;
    }

    const body = {
      name: serverName.trim(),
      host: serverHost.trim(),
      port: parsedPort,
      username: serverUsername.trim() || null,
      key_path: serverKeyPath.trim() || null,
    };

    setIsServerSubmitting(true);
    try {
      const response =
        serverModal.mode === "create"
          ? await post("/planning/servers", body)
          : await put(`/planning/servers/${serverModal.server.id}`, { ...body, position: serverModal.server.position });

      if (!response.ok) {
        pushToast("error", await readErrorMessage(response));
        return;
      }

      pushToast("success", serverModal.mode === "create" ? "Server added." : "Server updated.");
      setServerModal(null);
      await loadData();
    } catch {
      pushToast("error", "Something went wrong. Please try again.");
    } finally {
      setIsServerSubmitting(false);
    }
  }

  // ---- Project modal helpers ------------------------------------------------

  function openCreateProject() {
    setProjectName("");
    setProjectServerId("");
    setProjectKind("personal");
    setProjectRootPath("");
    setProjectDescription("");
    setProjectModal({ mode: "create" });
  }

  function openEditProject(project: Project) {
    setProjectName(project.name);
    setProjectServerId(project.server_id ? String(project.server_id) : "");
    setProjectKind(project.kind);
    setProjectRootPath(project.root_path ?? "");
    setProjectDescription(project.description ?? "");
    setProjectModal({ mode: "edit", project });
  }

  function closeProjectModal() {
    if (isProjectSubmitting) return;
    setProjectModal(null);
  }

  async function handleSubmitProject(event: FormEvent) {
    event.preventDefault();
    if (!projectModal) return;

    const body = {
      name: projectName.trim(),
      server_id: projectServerId ? Number.parseInt(projectServerId, 10) : null,
      kind: projectKind,
      root_path: projectRootPath.trim() || null,
      description: projectDescription.trim() || null,
    };

    setIsProjectSubmitting(true);
    try {
      const response =
        projectModal.mode === "create"
          ? await post("/planning/projects", body)
          : await put(`/planning/projects/${projectModal.project.id}`, { ...body, position: projectModal.project.position });

      if (!response.ok) {
        pushToast("error", await readErrorMessage(response));
        return;
      }

      pushToast("success", projectModal.mode === "create" ? "Project added." : "Project updated.");
      setProjectModal(null);
      await loadData();
    } catch {
      pushToast("error", "Something went wrong. Please try again.");
    } finally {
      setIsProjectSubmitting(false);
    }
  }

  // ---- Delete ---------------------------------------------------------------

  async function handleConfirmDelete() {
    if (!pendingConfirmation) return;
    setIsConfirmationBusy(true);
    try {
      if (pendingConfirmation.kind === "delete_server") {
        const response = await del(`/planning/servers/${pendingConfirmation.server.id}`);
        if (!response.ok) {
          pushToast("error", await readErrorMessage(response));
          return;
        }
        pushToast("success", "Server removed.");
      } else {
        const response = await del(`/planning/projects/${pendingConfirmation.project.id}`);
        if (!response.ok) {
          pushToast("error", await readErrorMessage(response));
          return;
        }
        pushToast("success", "Project removed.");
      }
      setPendingConfirmation(null);
      await loadData();
    } catch {
      pushToast("error", "Something went wrong. Please try again.");
    } finally {
      setIsConfirmationBusy(false);
    }
  }

  if (authState === "checking") {
    return <LoadingState />;
  }

  if (authState === "guest") {
    return <GuestHome />;
  }

  return (
    <div className="flex min-h-[calc(100vh-112px)] min-w-0 flex-col gap-10">
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      {/* Header */}
      <section className="px-1">
        <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Projects</h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 sm:text-base" style={{ color: "var(--foreground-muted)" }}>
          Register the servers you run agents on and the projects that live on them. This is the foundation for remote
          agent sessions.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs sm:text-sm" style={{ color: "var(--foreground-muted)" }}>
          <MetaItem icon={<ServerIcon className="h-3.5 w-3.5" aria-hidden="true" />}>{servers.length} servers</MetaItem>
          <MetaItem icon={<FolderGit2 className="h-3.5 w-3.5" aria-hidden="true" />}>{projects.length} projects</MetaItem>
        </div>
      </section>

      {isLoading ? (
        <LoadingState />
      ) : (
        <>
          {/* Servers */}
          <section>
            <div className="flex items-center justify-between gap-3 px-1">
              <div>
                <h3 className="text-xl font-semibold tracking-tight">Servers</h3>
                <p className="mt-1 text-sm" style={{ color: "var(--foreground-muted)" }}>
                  Machines reachable over SSH with public-key auth. No passwords are stored.
                </p>
              </div>
              <button
                type="button"
                onClick={openCreateServer}
                className="button-primary inline-flex h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                New server
              </button>
            </div>

            {servers.length === 0 ? (
              <div className="surface-subtle mt-4 rounded-[28px] px-6 py-10 text-center">
                <ServerIcon className="mx-auto h-8 w-8" style={{ color: "var(--foreground-muted)" }} aria-hidden="true" />
                <p className="mt-3 text-sm" style={{ color: "var(--foreground-muted)" }}>
                  No servers yet. Add the first machine to start mapping your infrastructure.
                </p>
              </div>
            ) : (
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                {servers.map((server) => (
                  <article key={server.id} className="surface-card group relative rounded-[28px] p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h4 className="truncate text-base font-semibold">{server.name}</h4>
                        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" style={{ color: "var(--foreground-muted)" }}>
                          <MetaItem icon={<Globe className="h-3.5 w-3.5" aria-hidden="true" />}>
                            {server.host}:{server.port}
                          </MetaItem>
                          {server.username ? (
                            <MetaItem icon={<Terminal className="h-3.5 w-3.5" aria-hidden="true" />}>{server.username}</MetaItem>
                          ) : null}
                          <MetaItem icon={<KeyRound className="h-3.5 w-3.5" aria-hidden="true" />}>
                            {server.key_path ? server.key_path : "default key"}
                          </MetaItem>
                        </div>
                      </div>
                      <ActionMenu menuKey={`server-${server.id}`} openMenuKey={openMenuKey} onToggle={toggleMenu} adaptiveDirection>
                        <ActionMenuItem onClick={() => { setOpenMenuKey(null); openEditServer(server); }}>
                          <span className="inline-flex items-center gap-2">
                            <PencilLine className="h-4 w-4" aria-hidden="true" /> Edit
                          </span>
                        </ActionMenuItem>
                        <ActionMenuItem tone="danger" onClick={() => { setOpenMenuKey(null); setPendingConfirmation({ kind: "delete_server", server }); }}>
                          <span className="inline-flex items-center gap-2">
                            <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete
                          </span>
                        </ActionMenuItem>
                      </ActionMenu>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          {/* Projects */}
          <section>
            <div className="flex items-center justify-between gap-3 px-1">
              <div>
                <h3 className="text-xl font-semibold tracking-tight">Projects</h3>
                <p className="mt-1 text-sm" style={{ color: "var(--foreground-muted)" }}>
                  Codebases an agent can operate in — each optionally pinned to a server and folder.
                </p>
              </div>
              <button
                type="button"
                onClick={openCreateProject}
                className="button-primary inline-flex h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                New project
              </button>
            </div>

            {projects.length === 0 ? (
              <div className="surface-subtle mt-4 rounded-[28px] px-6 py-10 text-center">
                <FolderGit2 className="mx-auto h-8 w-8" style={{ color: "var(--foreground-muted)" }} aria-hidden="true" />
                <p className="mt-3 text-sm" style={{ color: "var(--foreground-muted)" }}>
                  No projects yet. Add a project to describe a codebase agents will work on.
                </p>
              </div>
            ) : (
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                {projects.map((project) => {
                  const tone = kindTone(project.kind);
                  return (
                    <article key={project.id} className="surface-card group relative rounded-[28px] p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h4 className="truncate text-base font-semibold">{project.name}</h4>
                            <span
                              className="inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-medium"
                              style={{ backgroundColor: tone.background, color: tone.color }}
                            >
                              {KIND_LABELS[project.kind]}
                            </span>
                          </div>
                          {project.description ? (
                            <p className="mt-2 line-clamp-2 text-sm leading-6" style={{ color: "var(--foreground-muted)" }}>
                              {project.description}
                            </p>
                          ) : null}
                          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" style={{ color: "var(--foreground-muted)" }}>
                            <MetaItem icon={<ServerIcon className="h-3.5 w-3.5" aria-hidden="true" />}>
                              {project.server_name ? `${project.server_name} (${project.server_host})` : "No server"}
                            </MetaItem>
                            {project.root_path ? (
                              <MetaItem icon={<HardDrive className="h-3.5 w-3.5" aria-hidden="true" />}>{project.root_path}</MetaItem>
                            ) : null}
                          </div>
                        </div>
                        <ActionMenu menuKey={`project-${project.id}`} openMenuKey={openMenuKey} onToggle={toggleMenu} adaptiveDirection>
                          <ActionMenuItem onClick={() => { setOpenMenuKey(null); openEditProject(project); }}>
                            <span className="inline-flex items-center gap-2">
                              <PencilLine className="h-4 w-4" aria-hidden="true" /> Edit
                            </span>
                          </ActionMenuItem>
                          <ActionMenuItem tone="danger" onClick={() => { setOpenMenuKey(null); setPendingConfirmation({ kind: "delete_project", project }); }}>
                            <span className="inline-flex items-center gap-2">
                              <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete
                            </span>
                          </ActionMenuItem>
                        </ActionMenu>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}

      {/* Server modal */}
      <Modal
        isOpen={serverModal !== null}
        onClose={closeServerModal}
        title={serverModal?.mode === "edit" ? "Edit server" : "Add server"}
        description="Connection details for an SSH-reachable machine. Authentication is public-key only."
      >
        <form onSubmit={handleSubmitServer} className="space-y-4">
          <div>
            <label htmlFor="server-name" className="text-sm font-semibold">Name</label>
            <input
              id="server-name"
              value={serverName}
              onChange={(event) => setServerName(event.target.value)}
              className="field mt-2 rounded-2xl px-4 py-3 text-sm"
              placeholder="prod-box-1"
              required
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px]">
            <div>
              <label htmlFor="server-host" className="text-sm font-semibold">Host / IP</label>
              <input
                id="server-host"
                value={serverHost}
                onChange={(event) => setServerHost(event.target.value)}
                className="field mt-2 rounded-2xl px-4 py-3 text-sm"
                placeholder="203.0.113.10"
                required
              />
            </div>
            <div>
              <label htmlFor="server-port" className="text-sm font-semibold">Port</label>
              <input
                id="server-port"
                type="number"
                min={1}
                max={65535}
                value={serverPort}
                onChange={(event) => setServerPort(event.target.value)}
                className="field mt-2 rounded-2xl px-4 py-3 text-sm"
                required
              />
            </div>
          </div>

          <div>
            <label htmlFor="server-username" className="text-sm font-semibold">SSH username</label>
            <input
              id="server-username"
              value={serverUsername}
              onChange={(event) => setServerUsername(event.target.value)}
              className="field mt-2 rounded-2xl px-4 py-3 text-sm"
              placeholder="ubuntu"
            />
          </div>

          <div>
            <label htmlFor="server-key-path" className="text-sm font-semibold">Private key path</label>
            <input
              id="server-key-path"
              value={serverKeyPath}
              onChange={(event) => setServerKeyPath(event.target.value)}
              className="field mt-2 rounded-2xl px-4 py-3 text-sm"
              placeholder="~/.ssh/id_ed25519 (blank = default key)"
            />
            <p className="mt-1.5 text-xs" style={{ color: "var(--foreground-muted)" }}>
              Path on the local machine. Leave blank to use the default SSH key. The key itself is never stored here.
            </p>
          </div>

          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={closeServerModal} disabled={isServerSubmitting} className="button-secondary rounded-2xl px-4 py-3 text-sm font-medium">
              Cancel
            </button>
            <button type="submit" disabled={isServerSubmitting} className="button-primary rounded-2xl px-4 py-3 text-sm font-semibold">
              {isServerSubmitting ? "Saving..." : serverModal?.mode === "edit" ? "Save server" : "Add server"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Project modal */}
      <Modal
        isOpen={projectModal !== null}
        onClose={closeProjectModal}
        title={projectModal?.mode === "edit" ? "Edit project" : "Add project"}
        description="A codebase agents can operate on. Pin it to a server and folder where it lives."
      >
        <form onSubmit={handleSubmitProject} className="space-y-4">
          <div>
            <label htmlFor="project-name" className="text-sm font-semibold">Name</label>
            <input
              id="project-name"
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              className="field mt-2 rounded-2xl px-4 py-3 text-sm"
              placeholder="trading"
              required
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="project-kind" className="text-sm font-semibold">Kind</label>
              <select
                id="project-kind"
                value={projectKind}
                onChange={(event) => setProjectKind(event.target.value as ProjectKind)}
                className="field mt-2 rounded-2xl px-4 py-3 text-sm"
              >
                {PROJECT_KINDS.map((kind) => (
                  <option key={kind.value} value={kind.value}>{kind.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="project-server" className="text-sm font-semibold">Server</label>
              <select
                id="project-server"
                value={projectServerId}
                onChange={(event) => setProjectServerId(event.target.value)}
                className="field mt-2 rounded-2xl px-4 py-3 text-sm"
              >
                <option value="">No server</option>
                {servers.map((server) => (
                  <option key={server.id} value={String(server.id)}>{server.name} ({server.host})</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="project-root-path" className="text-sm font-semibold">Root path</label>
            <input
              id="project-root-path"
              value={projectRootPath}
              onChange={(event) => setProjectRootPath(event.target.value)}
              className="field mt-2 rounded-2xl px-4 py-3 text-sm"
              placeholder="/app/code/trading"
            />
          </div>

          <div>
            <label htmlFor="project-description" className="text-sm font-semibold">Description</label>
            <textarea
              id="project-description"
              value={projectDescription}
              onChange={(event) => setProjectDescription(event.target.value)}
              className="field mt-2 min-h-24 rounded-2xl px-4 py-3 text-sm"
              placeholder="Optional"
            />
          </div>

          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={closeProjectModal} disabled={isProjectSubmitting} className="button-secondary rounded-2xl px-4 py-3 text-sm font-medium">
              Cancel
            </button>
            <button type="submit" disabled={isProjectSubmitting} className="button-primary rounded-2xl px-4 py-3 text-sm font-semibold">
              {isProjectSubmitting ? "Saving..." : projectModal?.mode === "edit" ? "Save project" : "Add project"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete confirmation */}
      <Modal
        isOpen={pendingConfirmation !== null}
        onClose={() => {
          if (isConfirmationBusy) return;
          setPendingConfirmation(null);
        }}
        title={pendingConfirmation?.kind === "delete_server" ? "Remove server?" : "Remove project?"}
        description={
          pendingConfirmation?.kind === "delete_server"
            ? "Projects on this server will be unlinked, not deleted."
            : "This removes the selected project."
        }
      >
        <div className="space-y-4">
          <p className="text-sm leading-6" style={{ color: "var(--foreground-muted)" }}>
            {pendingConfirmation?.kind === "delete_server"
              ? `Remove server "${pendingConfirmation.server.name}"?`
              : pendingConfirmation?.kind === "delete_project"
                ? `Remove project "${pendingConfirmation.project.name}"?`
                : ""}
          </p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button type="button" onClick={() => setPendingConfirmation(null)} disabled={isConfirmationBusy} className="button-secondary rounded-2xl px-4 py-3 text-sm font-medium">
              Cancel
            </button>
            <button type="button" onClick={() => void handleConfirmDelete()} disabled={isConfirmationBusy} className="button-danger rounded-2xl px-4 py-3 text-sm font-semibold">
              {isConfirmationBusy ? "Removing..." : pendingConfirmation?.kind === "delete_server" ? "Remove server" : "Remove project"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
