"use client";

import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CircleStop,
  CornerDownLeft,
  Info,
  Loader2,
  Plus,
  RotateCw,
  Send,
  Server as ServerIcon,
  TerminalSquare,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { del, get, hasPlanningSession, post } from "../../utilities/api";
import Modal from "@/components/site/modal";
import ToastStack from "@/components/site/toast-stack";
import MetaItem from "@/components/site/meta-item";

type AuthState = "checking" | "authenticated" | "guest";

type Server = { id: number; name: string; host: string; port: number };

type Pane = { index: number; active: boolean; command: string };
type Win = { index: number; name: string; active: boolean; panes_count: number; panes: Pane[] };
type Session = { name: string; windows_count: number; activity: number; attached: boolean; windows: Win[] };

type ToastMessage = { id: number; type: "success" | "error"; message: string };

const POLL_MS = 1200;

const QUICK_KEYS: Array<{ key: string; label: string; icon?: typeof ArrowUp }> = [
  { key: "Enter", label: "Enter", icon: CornerDownLeft },
  { key: "Up", label: "Up", icon: ArrowUp },
  { key: "Down", label: "Down", icon: ArrowDown },
  { key: "Left", label: "Left", icon: ArrowLeft },
  { key: "Right", label: "Right", icon: ArrowRight },
  { key: "Escape", label: "Esc" },
  { key: "q", label: "q" },
  { key: "C-c", label: "Ctrl-C", icon: CircleStop },
];

function timeAgo(epochSeconds: number): string {
  if (!epochSeconds) return "unknown";
  const diff = Math.max(0, Math.floor(Date.now() / 1000 - epochSeconds));
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

async function readError(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (typeof payload?.detail === "string") return payload.detail;
  return `Request failed (${response.status})`;
}

function CommandBadge({ command }: { command: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[11px]"
      style={{ backgroundColor: "color-mix(in srgb, var(--background-elevated) 90%, transparent)", color: "var(--foreground-muted)" }}
    >
      {command || "?"}
    </span>
  );
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
          A live window into every tmux session on your servers.
        </h1>
        <p className="mt-4 max-w-xl text-base leading-7" style={{ color: "var(--foreground-muted)" }}>
          Sign in to list tmux sessions, preview their screens, and send keys — right from the browser.
        </p>
        <Link href="/login" className="button-primary mt-8 inline-flex rounded-full px-5 py-3 text-sm font-semibold">
          Sign in to your workspace
        </Link>
      </section>
    </div>
  );
}

export default function ServersPage() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [servers, setServers] = useState<Server[]>([]);
  const [serversError, setServersError] = useState<string | null>(null);
  const [selectedServerId, setSelectedServerId] = useState<number | null>(null);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);

  const [selectedSessionName, setSelectedSessionName] = useState<string | null>(null);
  const [selectedWindowIndex, setSelectedWindowIndex] = useState<number | null>(null);
  const [selectedPaneIndex, setSelectedPaneIndex] = useState<number | null>(null);

  const [snapshot, setSnapshot] = useState<string>("");
  const [snapshotError, setSnapshotError] = useState<string | null>(null);

  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [isLive, setIsLive] = useState(true);
  const [historyLines, setHistoryLines] = useState(500);
  const [message, setMessage] = useState("");

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newSessionName, setNewSessionName] = useState("");
  const [newCommand, setNewCommand] = useState("bash");
  const [newCwd, setNewCwd] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const pollRef = useRef<number | null>(null);

  function pushToast(type: ToastMessage["type"], text: string) {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, type, message: text }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 3500);
  }
  function dismissToast(id: number) {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }

  const selectedServer = useMemo(() => servers.find((server) => server.id === selectedServerId) ?? null, [servers, selectedServerId]);
  const selectedSession = useMemo(() => sessions.find((session) => session.name === selectedSessionName) ?? null, [sessions, selectedSessionName]);
  const selectedWindow = useMemo(
    () => selectedSession?.windows.find((window) => window.index === selectedWindowIndex) ?? null,
    [selectedSession, selectedWindowIndex],
  );
  const target = useMemo(() => {
    if (!selectedSessionName || selectedWindowIndex === null || selectedPaneIndex === null) return null;
    return `${selectedSessionName}:${selectedWindowIndex}.${selectedPaneIndex}`;
  }, [selectedSessionName, selectedWindowIndex, selectedPaneIndex]);

  function focusSession(session: Session | null) {
    if (!session) {
      setSelectedSessionName(null);
      setSelectedWindowIndex(null);
      setSelectedPaneIndex(null);
      return;
    }
    const activeWindow = session.windows.find((window) => window.active) ?? session.windows[0] ?? null;
    const activePane = activeWindow?.panes.find((pane) => pane.active) ?? activeWindow?.panes[0] ?? null;
    setSelectedSessionName(session.name);
    setSelectedWindowIndex(activeWindow?.index ?? null);
    setSelectedPaneIndex(activePane?.index ?? null);
  }

  function focusWindow(window: Win) {
    const activePane = window.panes.find((pane) => pane.active) ?? window.panes[0] ?? null;
    setSelectedWindowIndex(window.index);
    setSelectedPaneIndex(activePane?.index ?? null);
  }

  // --- data loading ---------------------------------------------------------

  const loadServers = useCallback(async () => {
    try {
      const response = await get("/planning/servers");
      if (!response.ok) {
        setServersError(await readError(response));
        return;
      }
      const data: Server[] = await response.json();
      setServers(data);
      setServersError(null);
      setSelectedServerId((current) => current ?? data[0]?.id ?? null);
    } catch {
      setServersError("Could not load servers.");
    }
  }, []);

  const loadSessions = useCallback(async (serverId: number, keepSelection: boolean) => {
    setTreeLoading(true);
    setTreeError(null);
    try {
      const response = await get(`/planning/servers/${serverId}/sessions`);
      const data = await response.json().catch(() => ({ ok: false, error: "Bad response" }));
      if (!response.ok || !data.ok) {
        setSessions([]);
        setTreeError(data?.error ?? (await readError(response)));
        focusSession(null);
        return;
      }
      const nextSessions: Session[] = data.sessions ?? [];
      setSessions(nextSessions);
      setTreeError(null);
      if (keepSelection && selectedSessionName) {
        const still = nextSessions.find((session) => session.name === selectedSessionName);
        if (still) {
          // keep window/pane if they still exist, else refocus
          const win = still.windows.find((w) => w.index === selectedWindowIndex);
          const pane = win?.panes.find((p) => p.index === selectedPaneIndex);
          if (!win || !pane) focusSession(still);
        } else {
          focusSession(nextSessions[0] ?? null);
        }
      } else {
        focusSession(nextSessions[0] ?? null);
      }
    } catch {
      setSessions([]);
      setTreeError("Could not reach the server.");
      focusSession(null);
    } finally {
      setTreeLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSessionName, selectedWindowIndex, selectedPaneIndex]);

  const loadSnapshot = useCallback(async () => {
    if (selectedServerId === null || !target) return;
    try {
      const linesParam = historyLines > 0 ? `&lines=${historyLines}` : "";
      const response = await get(`/planning/servers/${selectedServerId}/capture?target=${encodeURIComponent(target)}${linesParam}`);
      const data = await response.json().catch(() => ({ ok: false, error: "Bad response" }));
      if (!response.ok || !data.ok) {
        setSnapshotError(data?.error ?? "Capture failed");
        return;
      }
      setSnapshot(data.text ?? "");
      setSnapshotError(null);
    } catch {
      setSnapshotError("Could not capture the pane.");
    }
  }, [selectedServerId, target, historyLines]);

  // --- effects --------------------------------------------------------------

  useEffect(() => {
    setAuthState(hasPlanningSession() ? "authenticated" : "guest");
  }, []);

  useEffect(() => {
    if (authState === "authenticated") void loadServers();
  }, [authState, loadServers]);

  useEffect(() => {
    if (selectedServerId !== null) void loadSessions(selectedServerId, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedServerId]);

  // poll the focused pane
  useEffect(() => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (!isLive || !target) return;
    void loadSnapshot();
    pollRef.current = window.setInterval(() => void loadSnapshot(), POLL_MS);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [isLive, target, loadSnapshot]);

  // reset snapshot when target clears
  useEffect(() => {
    if (!target) {
      setSnapshot("");
      setSnapshotError(null);
    }
  }, [target]);

  // --- actions --------------------------------------------------------------

  async function sendKey(key: string) {
    if (selectedServerId === null || !target) return;
    try {
      const response = await post(`/planning/servers/${selectedServerId}/send-key`, { target, key });
      const data = await response.json().catch(() => ({ ok: false }));
      if (!response.ok || !data.ok) {
        pushToast("error", data?.error ?? "Could not send key");
        return;
      }
      window.setTimeout(() => void loadSnapshot(), 250);
    } catch {
      pushToast("error", "Could not send key");
    }
  }

  async function sendMessage() {
    if (selectedServerId === null || !target || !message.trim()) return;
    const text = message;
    setMessage("");
    try {
      const response = await post(`/planning/servers/${selectedServerId}/send-text`, { target, text, enter: true });
      const data = await response.json().catch(() => ({ ok: false }));
      if (!response.ok || !data.ok) {
        pushToast("error", data?.error ?? "Could not send text");
        return;
      }
      window.setTimeout(() => void loadSnapshot(), 250);
    } catch {
      pushToast("error", "Could not send text");
    }
  }

  async function createSession(event: React.FormEvent) {
    event.preventDefault();
    if (selectedServerId === null) return;
    setIsCreating(true);
    try {
      const response = await post(`/planning/servers/${selectedServerId}/sessions`, {
        name: newSessionName.trim(),
        command: newCommand.trim() || "bash",
        cwd: newCwd.trim() || null,
      });
      const data = await response.json().catch(() => ({ ok: false }));
      if (!response.ok || !data.ok) {
        pushToast("error", data?.error ?? "Could not create session");
        return;
      }
      pushToast("success", `Created session "${newSessionName.trim()}"`);
      const created = newSessionName.trim();
      setIsCreateOpen(false);
      setNewSessionName("");
      setNewCommand("bash");
      setNewCwd("");
      await loadSessions(selectedServerId, false);
      setSelectedSessionName(created);
      const server = selectedServerId;
      window.setTimeout(() => {
        setSessions((current) => {
          const match = current.find((s) => s.name === created);
          if (match) focusSession(match);
          return current;
        });
        void server;
      }, 0);
    } catch {
      pushToast("error", "Could not create session");
    } finally {
      setIsCreating(false);
    }
  }

  async function killSession(name: string) {
    if (selectedServerId === null) return;
    try {
      const response = await del(`/planning/servers/${selectedServerId}/sessions/${encodeURIComponent(name)}`);
      const data = await response.json().catch(() => ({ ok: false }));
      if (!response.ok || !data.ok) {
        pushToast("error", data?.error ?? "Could not kill session");
        return;
      }
      pushToast("success", `Killed session "${name}"`);
      await loadSessions(selectedServerId, false);
    } catch {
      pushToast("error", "Could not kill session");
    }
  }

  // --- render ---------------------------------------------------------------

  if (authState === "checking") return <div className="skeleton h-64 rounded-[28px]" />;
  if (authState === "guest") return <GuestHome />;

  return (
    <div className="flex min-h-[calc(100vh-112px)] min-w-0 flex-col gap-6">
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      {/* Header */}
      <section className="px-1">
        <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Servers</h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 sm:text-base" style={{ color: "var(--foreground-muted)" }}>
          Manage the tmux sessions on each server. Pick a server, open a session to preview its screen, and send keys —
          the same session you would reach with <span className="font-mono text-[0.85em]">tmux attach</span>.
        </p>
      </section>

      {/* Server switcher */}
      {serversError ? (
        <div className="surface-subtle rounded-2xl px-4 py-3 text-sm" style={{ color: "var(--danger)" }}>{serversError}</div>
      ) : servers.length === 0 ? (
        <div className="surface-subtle rounded-2xl px-4 py-3 text-sm" style={{ color: "var(--foreground-muted)" }}>
          No servers defined yet. Add one in the <Link href="/projects" className="font-semibold" style={{ color: "var(--accent)" }}>Projects</Link> section first.
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 px-1">
          {servers.map((server) => {
            const active = server.id === selectedServerId;
            return (
              <button
                key={server.id}
                type="button"
                onClick={() => setSelectedServerId(server.id)}
                className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition"
                style={{
                  borderColor: active ? "var(--accent)" : "color-mix(in srgb, var(--card-border) 70%, transparent)",
                  backgroundColor: active ? "var(--accent-tint)" : "transparent",
                  color: active ? "var(--accent)" : "var(--foreground)",
                }}
              >
                <ServerIcon className="h-4 w-4" aria-hidden="true" />
                <span>{server.name}</span>
                <span className="text-xs" style={{ color: "var(--foreground-muted)" }}>{server.host}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Master–detail */}
      {selectedServer ? (
        <div className="grid min-w-0 flex-1 gap-5 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]">
          {/* Session list */}
          <aside className="flex min-w-0 flex-col gap-3">
            <div className="flex items-center justify-between px-1">
              <p className="text-sm font-semibold">
                Sessions on <span style={{ color: "var(--accent)" }}>{selectedServer.name}</span>
              </p>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void loadSessions(selectedServer.id, true)}
                  className="button-secondary inline-flex h-9 w-9 items-center justify-center rounded-full"
                  title="Refresh sessions"
                >
                  <RotateCw className={`h-4 w-4 ${treeLoading ? "animate-spin" : ""}`} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(true)}
                  className="button-primary inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  New
                </button>
              </div>
            </div>

            {treeError ? (
              <div className="surface-subtle flex items-start gap-2 rounded-[24px] px-4 py-4 text-sm" style={{ color: "var(--danger)" }}>
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <div>
                  <p className="font-semibold">Couldn&apos;t reach {selectedServer.name}</p>
                  <p className="mt-1 break-words text-xs" style={{ color: "var(--foreground-muted)" }}>{treeError}</p>
                </div>
              </div>
            ) : treeLoading && sessions.length === 0 ? (
              <div className="skeleton h-24 rounded-[24px]" />
            ) : sessions.length === 0 ? (
              <div className="surface-subtle rounded-[24px] px-5 py-10 text-center">
                <TerminalSquare className="mx-auto h-8 w-8" style={{ color: "var(--foreground-muted)" }} aria-hidden="true" />
                <p className="mt-3 text-sm" style={{ color: "var(--foreground-muted)" }}>No tmux sessions running on this server.</p>
              </div>
            ) : (
              sessions.map((session) => {
                const active = session.name === selectedSessionName;
                const paneTotal = session.windows.reduce((sum, window) => sum + window.panes.length, 0);
                return (
                  <button
                    key={session.name}
                    type="button"
                    onClick={() => focusSession(session)}
                    className="surface-card rounded-[24px] p-4 text-left transition"
                    style={{
                      outline: active ? "2px solid var(--accent)" : "2px solid transparent",
                      boxShadow: active ? "var(--shadow-3)" : undefined,
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-mono text-sm font-semibold">{session.name}</span>
                      {session.attached ? (
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase" style={{ backgroundColor: "var(--success-tint)", color: "var(--success)" }}>attached</span>
                      ) : null}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: "var(--foreground-muted)" }}>
                      <span>{session.windows_count} {session.windows_count === 1 ? "window" : "windows"}</span>
                      <span>· {paneTotal} {paneTotal === 1 ? "pane" : "panes"}</span>
                      <span>· {timeAgo(session.activity)}</span>
                    </div>
                  </button>
                );
              })
            )}
          </aside>

          {/* Detail */}
          <section className="surface-card flex min-w-0 flex-col rounded-[28px]">
            {selectedSession && target ? (
              <>
                {/* Detail header */}
                <div className="flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: "color-mix(in srgb, var(--card-border) 60%, transparent)" }}>
                  <div className="min-w-0">
                    <h3 className="truncate font-mono text-lg font-semibold">{selectedSession.name}</h3>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: "var(--foreground-muted)" }}>
                      <MetaItem icon={<ServerIcon className="h-3.5 w-3.5" aria-hidden="true" />}>{selectedServer.name}</MetaItem>
                      <MetaItem icon={<TerminalSquare className="h-3.5 w-3.5" aria-hidden="true" />}>tmux attach -t {selectedSession.name}</MetaItem>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setIsLive((value) => !value)}
                      className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium"
                      style={{ borderColor: "color-mix(in srgb, var(--card-border) 70%, transparent)", color: isLive ? "var(--success)" : "var(--foreground-muted)" }}
                    >
                      <span className="relative flex h-2 w-2">
                        {isLive ? <span className="absolute inline-flex h-full w-full animate-ping rounded-full" style={{ backgroundColor: "var(--success)", opacity: 0.6 }} /> : null}
                        <span className="relative inline-flex h-2 w-2 rounded-full" style={{ backgroundColor: isLive ? "var(--success)" : "var(--foreground-muted)" }} />
                      </span>
                      {isLive ? "Live" : "Paused"}
                    </button>
                    <button type="button" onClick={() => void loadSnapshot()} className="button-secondary inline-flex h-9 w-9 items-center justify-center rounded-full" title="Refresh snapshot">
                      <RotateCw className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                {/* Window tabs (only when >1 window) */}
                {selectedSession.windows.length > 1 ? (
                  <div className="flex flex-wrap gap-1.5 px-5 pt-4">
                    {selectedSession.windows.map((window) => {
                      const active = window.index === selectedWindowIndex;
                      return (
                        <button
                          key={window.index}
                          type="button"
                          onClick={() => focusWindow(window)}
                          className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium"
                          style={{
                            borderColor: active ? "var(--accent)" : "color-mix(in srgb, var(--card-border) 70%, transparent)",
                            backgroundColor: active ? "var(--accent-tint)" : "transparent",
                            color: active ? "var(--accent)" : "var(--foreground-muted)",
                          }}
                        >
                          <span className="font-mono">{window.index}:{window.name}</span>
                          {window.panes.length > 1 ? <span className="opacity-70">({window.panes.length})</span> : null}
                        </button>
                      );
                    })}
                  </div>
                ) : null}

                {/* Pane chips (only when >1 pane in the window) */}
                {selectedWindow && selectedWindow.panes.length > 1 ? (
                  <div className="flex flex-wrap items-center gap-1.5 px-5 pt-3">
                    <span className="text-xs" style={{ color: "var(--foreground-muted)" }}>Pane:</span>
                    {selectedWindow.panes.map((pane) => {
                      const active = pane.index === selectedPaneIndex;
                      return (
                        <button
                          key={pane.index}
                          type="button"
                          onClick={() => setSelectedPaneIndex(pane.index)}
                          className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium"
                          style={{
                            borderColor: active ? "var(--accent)" : "color-mix(in srgb, var(--card-border) 70%, transparent)",
                            backgroundColor: active ? "var(--accent-tint)" : "transparent",
                            color: active ? "var(--accent)" : "var(--foreground-muted)",
                          }}
                        >
                          <span className="font-mono">%{pane.index}</span>
                          <CommandBadge command={pane.command} />
                        </button>
                      );
                    })}
                  </div>
                ) : null}

                {/* Terminal snapshot */}
                <div className="px-5 pt-4">
                  <div className="flex items-center justify-between gap-2 px-1 pb-2 text-xs" style={{ color: "var(--foreground-muted)" }}>
                    <span className="truncate font-mono">{target}</span>
                    <div className="flex shrink-0 items-center gap-2">
                      <label className="flex items-center gap-1">
                        <span>history</span>
                        <select
                          value={historyLines}
                          onChange={(event) => setHistoryLines(Number(event.target.value))}
                          className="rounded-md border bg-transparent px-1.5 py-0.5"
                          style={{ borderColor: "color-mix(in srgb, var(--card-border) 70%, transparent)", color: "var(--foreground)" }}
                        >
                          <option value={0}>Screen only</option>
                          <option value={100}>100 lines</option>
                          <option value={500}>500 lines</option>
                          <option value={2000}>2000 lines</option>
                        </select>
                      </label>
                      <span>{timeAgo(selectedSession.activity)}</span>
                    </div>
                  </div>
                  <div className="overflow-auto rounded-2xl" style={{ backgroundColor: "#0c0f14", border: "1px solid #232a33", maxHeight: "60vh" }}>
                    {snapshotError ? (
                      <div className="px-4 py-4 text-[12.5px]" style={{ fontFamily: "var(--font-mono)", color: "#eba7a0" }}>{snapshotError}</div>
                    ) : (
                      <pre className="min-w-[520px] px-4 py-4 text-[12.5px] leading-[1.5]" style={{ fontFamily: "var(--font-mono)", color: "#d6dde6", whiteSpace: "pre" }}>
                        {snapshot || " "}
                      </pre>
                    )}
                  </div>
                </div>

                {/* Composer + keys */}
                <div className="mt-auto px-5 pb-5 pt-4">
                  <div className="flex flex-wrap items-center gap-1.5 pb-3">
                    {QUICK_KEYS.map((quick) => {
                      const Icon = quick.icon;
                      return (
                        <button
                          key={quick.key}
                          type="button"
                          onClick={() => void sendKey(quick.key)}
                          className="inline-flex h-9 items-center gap-1 rounded-xl border px-2.5 text-xs font-medium"
                          style={{ borderColor: "color-mix(in srgb, var(--card-border) 70%, transparent)", color: "var(--foreground-muted)" }}
                          title={`Send ${quick.label}`}
                        >
                          {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                          {quick.label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex items-end gap-2">
                    <textarea
                      value={message}
                      onChange={(event) => setMessage(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                          event.preventDefault();
                          void sendMessage();
                        }
                      }}
                      rows={2}
                      placeholder="Type a command to send…  (⌘/Ctrl + Enter to send)"
                      className="field min-h-[52px] flex-1 rounded-2xl px-4 py-3 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => void sendMessage()}
                      disabled={!message.trim()}
                      className="button-primary inline-flex h-[52px] items-center gap-2 rounded-2xl px-4 text-sm font-semibold disabled:opacity-50"
                    >
                      <Send className="h-4 w-4" aria-hidden="true" />
                      Send
                    </button>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void killSession(selectedSession.name)}
                      className="button-danger inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                      Kill session
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
                {treeLoading ? (
                  <Loader2 className="h-8 w-8 animate-spin" style={{ color: "var(--foreground-muted)" }} aria-hidden="true" />
                ) : (
                  <>
                    <TerminalSquare className="h-9 w-9" style={{ color: "var(--foreground-muted)" }} aria-hidden="true" />
                    <p className="mt-3 text-sm" style={{ color: "var(--foreground-muted)" }}>Select a session to preview it, or create a new one.</p>
                  </>
                )}
              </div>
            )}
          </section>
        </div>
      ) : null}

      {/* New session modal */}
      <Modal
        isOpen={isCreateOpen}
        onClose={() => { if (!isCreating) setIsCreateOpen(false); }}
        title="New tmux session"
        description={selectedServer ? `Start a detached tmux session on ${selectedServer.name}.` : "Start a detached tmux session."}
      >
        <form onSubmit={createSession} className="space-y-4">
          <div>
            <label htmlFor="new-session-name" className="text-sm font-semibold">Session name</label>
            <input id="new-session-name" value={newSessionName} onChange={(event) => setNewSessionName(event.target.value)} className="field mt-2 rounded-2xl px-4 py-3 font-mono text-sm" placeholder="deploy" required />
          </div>
          <div>
            <label htmlFor="new-session-command" className="text-sm font-semibold">Command</label>
            <input id="new-session-command" value={newCommand} onChange={(event) => setNewCommand(event.target.value)} className="field mt-2 rounded-2xl px-4 py-3 font-mono text-sm" placeholder="bash" />
            <p className="mt-1.5 text-xs" style={{ color: "var(--foreground-muted)" }}>What runs in the pane. Leave as a shell, or run something directly (e.g. <span className="font-mono">./deploy.sh</span>).</p>
          </div>
          <div>
            <label htmlFor="new-session-cwd" className="text-sm font-semibold">Working directory</label>
            <input id="new-session-cwd" value={newCwd} onChange={(event) => setNewCwd(event.target.value)} className="field mt-2 rounded-2xl px-4 py-3 font-mono text-sm" placeholder="/app/code/planning (optional)" />
          </div>
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setIsCreateOpen(false)} disabled={isCreating} className="button-secondary rounded-2xl px-4 py-3 text-sm font-medium">Cancel</button>
            <button type="submit" disabled={isCreating} className="button-primary inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold">
              <Plus className="h-4 w-4" aria-hidden="true" />
              {isCreating ? "Creating…" : "Create session"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
