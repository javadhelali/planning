"use client";

import {
  Globe,
  KeyRound,
  PencilLine,
  Plus,
  Server as ServerIcon,
  SquareTerminal,
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

type ToastMessage = {
  id: number;
  type: "success" | "error";
  message: string;
};

type ServerModalState =
  | { mode: "create" }
  | { mode: "edit"; server: Server }
  | null;

async function readErrorMessage(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (typeof payload?.detail === "string") return payload.detail;
  return `Request failed (${response.status})`;
}

function GuestHome() {
  return (
    <div className="content-width mx-auto px-4 py-10 sm:px-6 sm:py-14">
      <section className="surface-card rounded-[28px] px-6 py-8 sm:px-8 sm:py-10">
        <span
          className="inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]"
          style={{ backgroundColor: "var(--accent-tint)", color: "var(--accent)" }}
        >
          Servers
        </span>
        <h1 className="mt-5 max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Every machine your agents can reach, in one place.
        </h1>
        <p className="mt-4 max-w-xl text-base leading-7" style={{ color: "var(--foreground-muted)" }}>
          Register the SSH-reachable servers you run agents on. Authentication is public-key only — no passwords are stored.
        </p>
        <Link href="/login" className="button-primary mt-8 inline-flex rounded-full px-5 py-3 text-sm font-semibold">
          Sign in to your workspace
        </Link>
      </section>
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

export default function ServersPage() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [isLoading, setIsLoading] = useState(true);
  const [servers, setServers] = useState<Server[]>([]);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null);

  const [serverModal, setServerModal] = useState<ServerModalState>(null);
  const [serverName, setServerName] = useState("");
  const [serverHost, setServerHost] = useState("");
  const [serverPort, setServerPort] = useState("22");
  const [serverUsername, setServerUsername] = useState("");
  const [serverKeyPath, setServerKeyPath] = useState("");
  const [isServerSubmitting, setIsServerSubmitting] = useState(false);

  const [pendingDelete, setPendingDelete] = useState<Server | null>(null);
  const [isDeleteBusy, setIsDeleteBusy] = useState(false);

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

  const loadServers = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await get("/planning/servers");
      if (response.ok) {
        setServers(await response.json());
      } else {
        pushToast("error", await readErrorMessage(response));
      }
    } catch {
      pushToast("error", "Could not load servers.");
    } finally {
      setIsLoading(false);
    }
  }, [pushToast]);

  useEffect(() => {
    setAuthState(hasPlanningSession() ? "authenticated" : "guest");
  }, []);

  useEffect(() => {
    if (authState !== "authenticated") return;
    void loadServers();
  }, [authState, loadServers]);

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

    const body = {
      name: serverName.trim(),
      host: serverHost.trim(),
      port: Number.parseInt(serverPort, 10) || 22,
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
      await loadServers();
    } catch {
      pushToast("error", "Something went wrong. Please try again.");
    } finally {
      setIsServerSubmitting(false);
    }
  }

  async function handleConfirmDelete() {
    if (!pendingDelete) return;
    setIsDeleteBusy(true);
    try {
      const response = await del(`/planning/servers/${pendingDelete.id}`);
      if (!response.ok) {
        pushToast("error", await readErrorMessage(response));
        return;
      }
      pushToast("success", "Server removed.");
      setPendingDelete(null);
      await loadServers();
    } catch {
      pushToast("error", "Something went wrong. Please try again.");
    } finally {
      setIsDeleteBusy(false);
    }
  }

  if (authState === "checking") return <LoadingState />;
  if (authState === "guest") return <GuestHome />;

  return (
    <div className="flex min-h-[calc(100vh-112px)] min-w-0 flex-col gap-8">
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      {/* Header */}
      <section className="flex flex-wrap items-end justify-between gap-3 px-1">
        <div>
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Servers</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 sm:text-base" style={{ color: "var(--foreground-muted)" }}>
            Machines reachable over SSH with public-key auth. Manage them here, link them to{" "}
            <Link href="/projects" className="font-semibold" style={{ color: "var(--accent)" }}>projects</Link>, and open their{" "}
            <Link href="/terminals" className="font-semibold" style={{ color: "var(--accent)" }}>terminals</Link>.
          </p>
          <div className="mt-2 flex items-center gap-x-4 text-xs sm:text-sm" style={{ color: "var(--foreground-muted)" }}>
            <MetaItem icon={<ServerIcon className="h-3.5 w-3.5" aria-hidden="true" />}>{servers.length} servers</MetaItem>
          </div>
        </div>
        <button
          type="button"
          onClick={openCreateServer}
          className="button-primary inline-flex h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          New server
        </button>
      </section>

      {isLoading ? (
        <LoadingState />
      ) : servers.length === 0 ? (
        <div className="surface-subtle rounded-[28px] px-6 py-12 text-center">
          <ServerIcon className="mx-auto h-8 w-8" style={{ color: "var(--foreground-muted)" }} aria-hidden="true" />
          <p className="mt-3 text-sm" style={{ color: "var(--foreground-muted)" }}>
            No servers yet. Add the first machine to start mapping your infrastructure.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
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
                  <Link
                    href="/terminals"
                    className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold"
                    style={{ color: "var(--accent)" }}
                  >
                    <SquareTerminal className="h-3.5 w-3.5" aria-hidden="true" />
                    Open terminals
                  </Link>
                </div>
                <ActionMenu menuKey={`server-${server.id}`} openMenuKey={openMenuKey} onToggle={toggleMenu} adaptiveDirection>
                  <ActionMenuItem onClick={() => { setOpenMenuKey(null); openEditServer(server); }}>
                    <span className="inline-flex items-center gap-2">
                      <PencilLine className="h-4 w-4" aria-hidden="true" /> Edit
                    </span>
                  </ActionMenuItem>
                  <ActionMenuItem tone="danger" onClick={() => { setOpenMenuKey(null); setPendingDelete(server); }}>
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

      {/* Delete confirmation */}
      <Modal
        isOpen={pendingDelete !== null}
        onClose={() => {
          if (isDeleteBusy) return;
          setPendingDelete(null);
        }}
        title="Remove server?"
        description="Projects on this server will be unlinked, not deleted."
      >
        <div className="space-y-4">
          <p className="text-sm leading-6" style={{ color: "var(--foreground-muted)" }}>
            {pendingDelete ? `Remove server "${pendingDelete.name}"?` : ""}
          </p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button type="button" onClick={() => setPendingDelete(null)} disabled={isDeleteBusy} className="button-secondary rounded-2xl px-4 py-3 text-sm font-medium">
              Cancel
            </button>
            <button type="button" onClick={() => void handleConfirmDelete()} disabled={isDeleteBusy} className="button-danger rounded-2xl px-4 py-3 text-sm font-semibold">
              {isDeleteBusy ? "Removing..." : "Remove server"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
