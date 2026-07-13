"use client";

import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CircleStop,
  ChevronDown,
  ChevronRight,
  CornerDownLeft,
  FolderGit2,
  History,
  Loader2,
  LogOut,
  Mic,
  Plus,
  RotateCw,
  Send,
  Server as ServerIcon,
  Sparkles,
  TerminalSquare,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { get, hasPlanningSession, post } from "../../utilities/api";
import ToastStack from "@/components/site/toast-stack";
import AnsiText from "@/components/site/ansi-text";

type AuthState = "checking" | "authenticated" | "guest";

type Server = { id: number; name: string; host: string; port: number };

type Pane = { index: number; active: boolean; command: string; current_path: string };
type Win = { index: number; name: string; active: boolean; panes_count: number; panes: Pane[] };
type Session = { name: string; windows_count: number; activity: number; attached: boolean; windows: Win[] };

type Project = { id: number; name: string; server_id: number | null; root_path: string | null };

type HistoryItem = { command: string; count: number };

type ToastMessage = { id: number; type: "success" | "error"; message: string };

// One terminal (tmux pane) in the tree, plus the display label to show for it.
type PaneRef = { session: Session; win: Win; pane: Pane; target: string; label: string };
type PaneGroup = { key: string; label: string; project: Project | null; panes: PaneRef[] };

const POLL_MS = 1200;
const MAX_SUGGESTIONS = 120;

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

// Handy Claude Code slash commands, sent to the active pane on click. Interactive
// ones (like /resume) open a picker you then drive with the arrow quick keys.
const CLAUDE_COMMANDS = ["/clear", "/resume", "/compact", "/context", "/model", "/help"];

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
          Terminals
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

const softBorder = "color-mix(in srgb, var(--card-border) 70%, transparent)";

// Is `paneCwd` inside project root `root`? Tolerant of how the root was typed:
// trailing slashes, a leading "~", or a relative path all still match against
// tmux's absolute pane_current_path by comparing the normalized tail.
function pathUnder(paneCwd: string | null | undefined, root: string | null | undefined): boolean {
  const p = paneCwd?.replace(/\/+$/, "");
  const full = root?.replace(/\/+$/, "");
  if (!p || !full) return false;
  if (p === full || p.startsWith(`${full}/`)) return true;
  const tail = full.replace(/^~?\/?/, "/");
  if (tail !== full && tail !== "/") {
    if (p === tail || p.startsWith(`${tail}/`) || p.endsWith(tail) || p.includes(`${tail}/`)) return true;
  }
  return false;
}

// Match a single working directory to a project on the given server; the deepest
// (longest) matching root wins for nested projects.
function matchProject(path: string | null | undefined, projects: Project[], serverId: number | null): Project | null {
  if (serverId === null) return null;
  let best: Project | null = null;
  let bestLen = -1;
  for (const project of projects) {
    if (project.server_id !== serverId || !project.root_path) continue;
    if (pathUnder(path, project.root_path) && project.root_path.length > bestLen) {
      best = project;
      bestLen = project.root_path.length;
    }
  }
  return best;
}

// Flatten a server's sessions into panes (terminals) grouped by project. Each
// pane is placed by its own cwd, so a session with panes in different projects
// splits across groups. Every project on the server gets a group even with no
// panes, so you can still open a terminal in it. Unmatched panes land in
// "Other" (always last).
function buildPaneGroups(sessions: Session[], projects: Project[], serverId: number): PaneGroup[] {
  const order: string[] = [];
  const map = new Map<string, PaneGroup>();
  const ensure = (key: string, label: string, project: Project | null) => {
    let group = map.get(key);
    if (!group) {
      group = { key, label, project, panes: [] };
      map.set(key, group);
      order.push(key);
    }
    return group;
  };
  // Seed a group for each of the server's projects so empty ones still show.
  for (const project of projects) {
    if (project.server_id === serverId) ensure(`p-${project.id}`, project.name, project);
  }
  for (const session of sessions) {
    const totalPanes = session.windows.reduce((sum, win) => sum + win.panes.length, 0);
    for (const win of session.windows) {
      for (const pane of win.panes) {
        const project = matchProject(pane.current_path, projects, serverId);
        const group = ensure(project ? `p-${project.id}` : "other", project ? project.name : "Other", project);
        const target = `${session.name}:${win.index}.${pane.index}`;
        group.panes.push({ session, win, pane, target, label: totalPanes > 1 ? target : session.name });
      }
    }
  }
  const groups = order.filter((key) => key !== "other").map((key) => map.get(key)!);
  const other = map.get("other");
  if (other) groups.push(other);
  return groups;
}

export default function TerminalsPage() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [servers, setServers] = useState<Server[]>([]);
  const [serversError, setServersError] = useState<string | null>(null);
  const [selectedServerId, setSelectedServerId] = useState<number | null>(null);

  // Sessions per server, loaded once on demand (never on a timer).
  const [serverTrees, setServerTrees] = useState<Record<number, Session[]>>({});
  const [treeErrors, setTreeErrors] = useState<Record<number, string>>({});
  const [treesLoading, setTreesLoading] = useState(false);

  const [selectedSessionName, setSelectedSessionName] = useState<string | null>(null);
  const [selectedWindowIndex, setSelectedWindowIndex] = useState<number | null>(null);
  const [selectedPaneIndex, setSelectedPaneIndex] = useState<number | null>(null);

  const [snapshot, setSnapshot] = useState<string>("");
  const [snapshotError, setSnapshotError] = useState<string | null>(null);

  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [projects, setProjects] = useState<Project[]>([]);

  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [isLive, setIsLive] = useState(true);
  const [historyLines, setHistoryLines] = useState(500);
  const [message, setMessage] = useState("");

  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(() => new Set());

  const [exitArmed, setExitArmed] = useState(false);
  const exitArmTimer = useRef<number | null>(null);

  const pollRef = useRef<number | null>(null);
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  function pushToast(type: ToastMessage["type"], text: string) {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, type, message: text }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 3500);
  }
  function dismissToast(id: number) {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }

  const selectedSessions = useMemo(
    () => (selectedServerId !== null ? serverTrees[selectedServerId] ?? [] : []),
    [serverTrees, selectedServerId],
  );
  const selectedSession = useMemo(
    () => selectedSessions.find((session) => session.name === selectedSessionName) ?? null,
    [selectedSessions, selectedSessionName],
  );
  const selectedWindow = useMemo(
    () => selectedSession?.windows.find((window) => window.index === selectedWindowIndex) ?? null,
    [selectedSession, selectedWindowIndex],
  );
  const target = useMemo(() => {
    if (!selectedSession || selectedWindowIndex === null || selectedPaneIndex === null) return null;
    return `${selectedSession.name}:${selectedWindowIndex}.${selectedPaneIndex}`;
  }, [selectedSession, selectedWindowIndex, selectedPaneIndex]);

  const activePane = useMemo(
    () => selectedWindow?.panes.find((pane) => pane.index === selectedPaneIndex) ?? null,
    [selectedWindow, selectedPaneIndex],
  );

  const activeProject = useMemo(
    () => matchProject(activePane?.current_path, projects, selectedServerId),
    [activePane, projects, selectedServerId],
  );

  // Filter the zsh history for the suggestions panel: prefix matches first,
  // then substring matches. Empty composer → most recent commands.
  const suggestions = useMemo(() => {
    const query = message.trim().toLowerCase();
    if (!query) return history.slice(0, MAX_SUGGESTIONS);
    const starts: HistoryItem[] = [];
    const contains: HistoryItem[] = [];
    for (const item of history) {
      const command = item.command.toLowerCase();
      if (command === query) continue;
      if (command.startsWith(query)) starts.push(item);
      else if (command.includes(query)) contains.push(item);
    }
    return [...starts, ...contains].slice(0, MAX_SUGGESTIONS);
  }, [history, message]);

  function selectPane(serverId: number, sessionName: string, windowIndex: number, paneIndex: number) {
    setSelectedServerId(serverId);
    setSelectedSessionName(sessionName);
    setSelectedWindowIndex(windowIndex);
    setSelectedPaneIndex(paneIndex);
  }

  function toggleNode(key: string) {
    setCollapsedNodes((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function autosizeComposer() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }

  function applySuggestion(command: string) {
    setMessage(command);
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      autosizeComposer();
    });
  }

  // --- data loading ---------------------------------------------------------

  const loadServers = useCallback(async (): Promise<Server[]> => {
    try {
      const response = await get("/planning/servers");
      if (!response.ok) {
        setServersError(await readError(response));
        return [];
      }
      const data: Server[] = await response.json();
      setServers(data);
      setServersError(null);
      setSelectedServerId((current) => current ?? data[0]?.id ?? null);
      return data;
    } catch {
      setServersError("Could not load servers.");
      return [];
    }
  }, []);

  const loadTree = useCallback(async (serverId: number): Promise<Session[]> => {
    try {
      const response = await get(`/planning/servers/${serverId}/sessions`);
      const data = await response.json().catch(() => ({ ok: false, error: "Bad response" }));
      if (!response.ok || !data.ok) {
        const message = data?.error ?? (await readError(response));
        setServerTrees((current) => ({ ...current, [serverId]: [] }));
        setTreeErrors((current) => ({ ...current, [serverId]: message }));
        return [];
      }
      const sessions: Session[] = data.sessions ?? [];
      setServerTrees((current) => ({ ...current, [serverId]: sessions }));
      setTreeErrors((current) => {
        const next = { ...current };
        delete next[serverId];
        return next;
      });
      return sessions;
    } catch {
      setServerTrees((current) => ({ ...current, [serverId]: [] }));
      setTreeErrors((current) => ({ ...current, [serverId]: "Could not reach the server." }));
      return [];
    }
  }, []);

  const loadAllTrees = useCallback(async (list: Server[]) => {
    setTreesLoading(true);
    try {
      await Promise.all(list.map((server) => loadTree(server.id)));
    } finally {
      setTreesLoading(false);
    }
  }, [loadTree]);

  const loadProjects = useCallback(async () => {
    try {
      const response = await get("/planning/projects");
      if (!response.ok) return;
      const data: Project[] = await response.json();
      setProjects(Array.isArray(data) ? data : []);
    } catch {
      // Non-critical: without projects, terminals just group under "Other".
    }
  }, []);

  const refreshAll = useCallback(async () => {
    const list = await loadServers();
    await Promise.all([loadAllTrees(list), loadProjects()]);
  }, [loadServers, loadAllTrees, loadProjects]);

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

  const loadHistory = useCallback(async (serverId: number) => {
    setHistoryLoading(true);
    try {
      const response = await get(`/planning/servers/${serverId}/command-history`);
      const data = await response.json().catch(() => ({ ok: false }));
      if (response.ok && data.ok) setHistory(data.items ?? []);
      else setHistory([]);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  // --- effects --------------------------------------------------------------

  useEffect(() => {
    setAuthState(hasPlanningSession() ? "authenticated" : "guest");
  }, []);

  // Load servers + their trees + projects once when authenticated. No polling.
  useEffect(() => {
    if (authState === "authenticated") void refreshAll();
  }, [authState, refreshAll]);

  // Load the command history for whichever server the active terminal is on.
  useEffect(() => {
    if (selectedServerId !== null) void loadHistory(selectedServerId);
  }, [selectedServerId, loadHistory]);

  // Auto-select the first available terminal when nothing is selected yet.
  useEffect(() => {
    if (selectedSessionName) return;
    for (const server of servers) {
      const sessions = serverTrees[server.id];
      const session = sessions?.[0];
      if (!session) continue;
      const win = session.windows.find((w) => w.active) ?? session.windows[0];
      const pane = win?.panes.find((p) => p.active) ?? win?.panes[0];
      if (win && pane) {
        selectPane(server.id, session.name, win.index, pane.index);
        break;
      }
    }
  }, [servers, serverTrees, selectedSessionName]);

  // If the selected terminal's session vanished (killed / gone on refresh),
  // clear the selection so the auto-select effect can pick another.
  useEffect(() => {
    if (!selectedSessionName || selectedServerId === null) return;
    const sessions = serverTrees[selectedServerId];
    if (sessions && !sessions.some((session) => session.name === selectedSessionName)) {
      setSelectedSessionName(null);
      setSelectedWindowIndex(null);
      setSelectedPaneIndex(null);
    }
  }, [serverTrees, selectedServerId, selectedSessionName]);

  // Poll only the active terminal.
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

  useEffect(() => {
    if (!target) {
      setSnapshot("");
      setSnapshotError(null);
    }
    // Reset the exit confirmation whenever the active pane changes.
    setExitArmed(false);
    if (exitArmTimer.current) {
      window.clearTimeout(exitArmTimer.current);
      exitArmTimer.current = null;
    }
  }, [target]);

  // A new pane starts pinned to the bottom (latest output).
  useEffect(() => {
    stickToBottomRef.current = true;
    const el = terminalRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [target]);

  // Follow the tail as new output streams in, unless the user scrolled up.
  useEffect(() => {
    const el = terminalRef.current;
    if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [snapshot]);

  useEffect(() => {
    autosizeComposer();
  }, [message]);

  function onTerminalScroll() {
    const el = terminalRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  }

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

  async function sendText(text: string) {
    if (selectedServerId === null || !target || !text.trim()) return;
    const serverId = selectedServerId;
    try {
      const response = await post(`/planning/servers/${serverId}/send-text`, { target, text, enter: true });
      const data = await response.json().catch(() => ({ ok: false }));
      if (!response.ok || !data.ok) {
        pushToast("error", data?.error ?? "Could not send text");
        return;
      }
      window.setTimeout(() => void loadSnapshot(), 250);
      // Newly-run commands land in the server's history shortly after.
      window.setTimeout(() => void loadHistory(serverId), 1500);
    } catch {
      pushToast("error", "Could not send text");
    }
  }

  function sendMessage() {
    if (!message.trim()) return;
    const text = message;
    setMessage("");
    void sendText(text);
  }

  // Pick a session name not already in use on the server (tmux names must be unique).
  function uniqueSessionName(serverId: number, base: string): string {
    const existing = new Set((serverTrees[serverId] ?? []).map((session) => session.name));
    const clean = base.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/^-+|-+$/g, "") || "term";
    if (!existing.has(clean)) return clean;
    let index = 2;
    while (existing.has(`${clean}-${index}`)) index += 1;
    return `${clean}-${index}`;
  }

  // Spin up a detached tmux session, refresh the tree, and jump to its pane.
  // No command is sent, so tmux launches the server's default shell (usually zsh).
  async function createTerminal(serverId: number, name: string, cwd: string | null) {
    try {
      const response = await post(`/planning/servers/${serverId}/sessions`, { name, cwd });
      const data = await response.json().catch(() => ({ ok: false }));
      if (!response.ok || !data.ok) {
        pushToast("error", data?.error ?? "Could not create session");
        return;
      }
      pushToast("success", `Created terminal "${name}"`);
      const sessions = await loadTree(serverId);
      const match = sessions.find((session) => session.name === name);
      if (match) {
        const win = match.windows.find((w) => w.active) ?? match.windows[0];
        const pane = win?.panes.find((p) => p.active) ?? win?.panes[0];
        if (win && pane) selectPane(serverId, match.name, win.index, pane.index);
      }
    } catch {
      pushToast("error", "Could not create session");
    }
  }

  function openTerminalForServer(server: Server) {
    void createTerminal(server.id, uniqueSessionName(server.id, "term"), null);
  }

  function openTerminalForProject(project: Project) {
    if (project.server_id === null) return;
    void createTerminal(project.server_id, uniqueSessionName(project.server_id, project.name), project.root_path ?? null);
  }

  function disarmExit() {
    if (exitArmTimer.current) {
      window.clearTimeout(exitArmTimer.current);
      exitArmTimer.current = null;
    }
    setExitArmed(false);
  }

  // Exit the active pane by sending Ctrl-D (EOF) to its shell, then refresh the
  // server's terminal list so the closed pane/session drops out of the tree.
  // The first click arms the button; a second click within a few seconds confirms.
  async function exitPane() {
    if (selectedServerId === null || !target) return;
    if (!exitArmed) {
      setExitArmed(true);
      exitArmTimer.current = window.setTimeout(() => disarmExit(), 3000);
      return;
    }
    disarmExit();
    const serverId = selectedServerId;
    await sendKey("C-d");
    window.setTimeout(() => void loadTree(serverId), 500);
  }

  // --- render ---------------------------------------------------------------

  if (authState === "checking") return <div className="skeleton h-64 rounded-[28px]" />;
  if (authState === "guest") return <GuestHome />;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-3">
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      {serversError ? (
        <div className="surface-subtle rounded-2xl px-4 py-3 text-sm" style={{ color: "var(--danger)" }}>{serversError}</div>
      ) : servers.length === 0 ? (
        <div className="surface-subtle rounded-2xl px-4 py-3 text-sm" style={{ color: "var(--foreground-muted)" }}>
          No servers defined yet. Add one in the <Link href="/servers" className="font-semibold" style={{ color: "var(--accent)" }}>Servers</Link> section first.
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[260px_minmax(0,1fr)_300px]">
          {/* Navigator tree — server → project → terminals */}
          <aside className="surface-card flex max-h-[38vh] min-h-0 flex-col overflow-hidden rounded-[24px] lg:max-h-none">
            <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5" style={{ borderColor: "color-mix(in srgb, var(--card-border) 60%, transparent)" }}>
              <span className="text-sm font-semibold">Terminals</span>
              <button
                type="button"
                onClick={() => void refreshAll()}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border"
                style={{ borderColor: softBorder, color: "var(--foreground-muted)" }}
                title="Refresh list"
              >
                <RotateCw className={`h-3.5 w-3.5 ${treesLoading ? "animate-spin" : ""}`} aria-hidden="true" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto px-1.5 py-2">
              {servers.map((server) => {
                const sessions = serverTrees[server.id] ?? [];
                const error = treeErrors[server.id];
                const groups = buildPaneGroups(sessions, projects, server.id);
                const srvKey = `srv-${server.id}`;
                const srvCollapsed = collapsedNodes.has(srvKey);
                return (
                  <div key={server.id} className="mb-0.5">
                    {/* Server row */}
                    <div className="flex items-center gap-1 rounded-lg px-1 py-1">
                      <button type="button" onClick={() => toggleNode(srvKey)} className="inline-flex h-5 w-5 shrink-0 items-center justify-center" title={srvCollapsed ? "Expand" : "Collapse"}>
                        {srvCollapsed ? <ChevronRight className="h-3.5 w-3.5" style={{ color: "var(--foreground-muted)" }} aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5" style={{ color: "var(--foreground-muted)" }} aria-hidden="true" />}
                      </button>
                      <ServerIcon className="h-4 w-4 shrink-0" style={{ color: "var(--foreground-muted)" }} aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={`${server.name} · ${server.host}`}>{server.name}</span>
                      <button
                        type="button"
                        onClick={() => openTerminalForServer(server)}
                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border"
                        style={{ borderColor: softBorder, color: "var(--foreground-muted)" }}
                        title={`New terminal on ${server.name} (home directory)`}
                      >
                        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>

                    {!srvCollapsed ? (
                      error ? (
                        <p className="px-2 py-1.5 pl-8 text-xs" style={{ color: "var(--danger)" }}>{error}</p>
                      ) : groups.length === 0 ? (
                        <p className="px-2 py-1.5 pl-8 text-xs" style={{ color: "var(--foreground-muted)" }}>
                          {treesLoading ? "Loading…" : "No terminals here."}
                        </p>
                      ) : (
                        groups.map((group) => {
                          const groupKey = `${srvKey}/${group.key}`;
                          const groupCollapsed = collapsedNodes.has(groupKey);
                          return (
                            <div key={groupKey}>
                              {/* Project row */}
                              <div className="flex items-center gap-1 rounded-lg py-1 pl-6 pr-1">
                                <button type="button" onClick={() => toggleNode(groupKey)} className="inline-flex h-5 w-5 shrink-0 items-center justify-center" title={groupCollapsed ? "Expand" : "Collapse"}>
                                  {groupCollapsed ? <ChevronRight className="h-3.5 w-3.5" style={{ color: "var(--foreground-muted)" }} aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5" style={{ color: "var(--foreground-muted)" }} aria-hidden="true" />}
                                </button>
                                {group.project ? (
                                  <FolderGit2 className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--accent)" }} aria-hidden="true" />
                                ) : null}
                                <span className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--foreground-muted)" }}>{group.label}</span>
                                <span className="shrink-0 text-[10px]" style={{ color: "var(--foreground-muted)" }}>{group.panes.length}</span>
                                {group.project ? (
                                  <button
                                    type="button"
                                    onClick={() => openTerminalForProject(group.project!)}
                                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border"
                                    style={{ borderColor: softBorder, color: "var(--foreground-muted)" }}
                                    title={`New terminal in ${group.project.name}${group.project.root_path ? ` (${group.project.root_path})` : ""}`}
                                  >
                                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                                  </button>
                                ) : null}
                              </div>

                              {!groupCollapsed && group.panes.length === 0 ? (
                                <p className="py-1 pl-12 pr-2 text-[11px]" style={{ color: "var(--foreground-muted)" }}>
                                  {group.project ? "No terminals yet — use +" : "No terminals."}
                                </p>
                              ) : null}

                              {!groupCollapsed
                                ? group.panes.map((ref) => {
                                    const active = server.id === selectedServerId && ref.target === target;
                                    return (
                                      <button
                                        key={ref.target}
                                        type="button"
                                        onClick={() => selectPane(server.id, ref.session.name, ref.win.index, ref.pane.index)}
                                        title={`${ref.target} · ${timeAgo(ref.session.activity)}`}
                                        className="flex w-full items-center gap-1.5 rounded-lg py-1.5 pl-12 pr-2 text-left transition"
                                        style={active ? { backgroundColor: "var(--accent-tint)", color: "var(--accent)" } : { color: "var(--foreground)" }}
                                      >
                                        <span
                                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                                          style={{ backgroundColor: ref.session.attached ? "var(--success)" : "color-mix(in srgb, var(--foreground-muted) 45%, transparent)" }}
                                          aria-hidden="true"
                                        />
                                        <span className="min-w-0 flex-1 truncate font-mono text-xs">{ref.label}</span>
                                        <CommandBadge command={ref.pane.command} />
                                      </button>
                                    );
                                  })
                                : null}
                            </div>
                          );
                        })
                      )
                    ) : null}
                  </div>
                );
              })}
            </div>
          </aside>

          {/* Terminal */}
          <section className="surface-card flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[24px]">
            {selectedSession && target ? (
              <>
                {/* Terminal header */}
                <div
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2.5"
                  style={{ borderColor: "color-mix(in srgb, var(--card-border) 60%, transparent)" }}
                >
                  <span className="truncate font-mono text-xs font-semibold" title={target}>{target}</span>

                  {activeProject ? (
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
                      style={{ backgroundColor: "var(--accent-tint)", color: "var(--accent)" }}
                      title={`This pane is inside project “${activeProject.name}”${activeProject.root_path ? ` · ${activeProject.root_path}` : ""}`}
                    >
                      <FolderGit2 className="h-3.5 w-3.5" aria-hidden="true" />
                      {activeProject.name}
                    </span>
                  ) : null}

                  <div className="ml-auto flex items-center gap-1.5">
                    <select
                      value={historyLines}
                      onChange={(event) => setHistoryLines(Number(event.target.value))}
                      className="rounded-md border bg-transparent px-1.5 py-1 text-xs"
                      style={{ borderColor: softBorder, color: "var(--foreground-muted)" }}
                      title="Scrollback captured"
                    >
                      <option value={0}>Screen</option>
                      <option value={100}>100 lines</option>
                      <option value={500}>500 lines</option>
                      <option value={2000}>2000 lines</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => setIsLive((value) => !value)}
                      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium"
                      style={{ borderColor: softBorder, color: isLive ? "var(--success)" : "var(--foreground-muted)" }}
                      title={isLive ? "Live — pause updates" : "Paused — resume updates"}
                    >
                      <span className="relative flex h-2 w-2">
                        {isLive ? <span className="absolute inline-flex h-full w-full animate-ping rounded-full" style={{ backgroundColor: "var(--success)", opacity: 0.6 }} /> : null}
                        <span className="relative inline-flex h-2 w-2 rounded-full" style={{ backgroundColor: isLive ? "var(--success)" : "var(--foreground-muted)" }} />
                      </span>
                      {isLive ? "Live" : "Paused"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void loadSnapshot()}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full border"
                      style={{ borderColor: softBorder, color: "var(--foreground-muted)" }}
                      title="Refresh snapshot"
                    >
                      <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                {/* Terminal screen */}
                <div
                  ref={terminalRef}
                  onScroll={onTerminalScroll}
                  className="min-h-0 flex-1 overflow-auto"
                  style={{ backgroundColor: "#0c0f14" }}
                >
                  {snapshotError ? (
                    <div className="px-4 py-4 text-[12.5px]" style={{ fontFamily: "var(--font-mono)", color: "#eba7a0" }}>{snapshotError}</div>
                  ) : (
                    <pre className="min-w-[520px] px-4 py-4 text-[12.5px] leading-[1.5]" style={{ fontFamily: "var(--font-mono)", color: "#d6dde6", whiteSpace: "pre" }}>
                      <AnsiText text={snapshot} />
                    </pre>
                  )}
                </div>

                {/* Quick keys */}
                <div className="flex flex-wrap items-center gap-1.5 border-t px-4 pt-3" style={{ borderColor: "color-mix(in srgb, var(--card-border) 60%, transparent)" }}>
                  {QUICK_KEYS.map((quick) => {
                    const Icon = quick.icon;
                    return (
                      <button
                        key={quick.key}
                        type="button"
                        onClick={() => void sendKey(quick.key)}
                        className="inline-flex h-8 items-center gap-1 rounded-lg border px-2 text-xs font-medium"
                        style={{ borderColor: softBorder, color: "var(--foreground-muted)" }}
                        title={`Send ${quick.label}`}
                      >
                        {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                        {quick.label}
                      </button>
                    );
                  })}

                  <span className="mx-1 h-5 w-px shrink-0" style={{ backgroundColor: softBorder }} aria-hidden="true" />
                  <Sparkles className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--accent)" }} aria-hidden="true" />
                  {CLAUDE_COMMANDS.map((command) => (
                    <button
                      key={command}
                      type="button"
                      onClick={() => void sendText(command)}
                      className="inline-flex h-8 items-center rounded-lg border px-2 font-mono text-xs font-medium"
                      style={{ borderColor: "color-mix(in srgb, var(--accent) 40%, transparent)", color: "var(--accent)" }}
                      title={`Run ${command} in Claude Code`}
                    >
                      {command}
                    </button>
                  ))}

                  <button
                    type="button"
                    onClick={() => void exitPane()}
                    onBlur={() => exitArmed && disarmExit()}
                    className="ml-auto inline-flex h-8 items-center gap-1 rounded-lg border px-2 text-xs font-medium transition"
                    style={
                      exitArmed
                        ? { borderColor: "var(--danger)", backgroundColor: "var(--danger)", color: "var(--background)" }
                        : { borderColor: "color-mix(in srgb, var(--danger) 40%, transparent)", color: "var(--danger)" }
                    }
                    title="Exit this terminal (Ctrl-D) — closes the pane"
                  >
                    <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                    {exitArmed ? "Click to confirm" : "Exit"}
                  </button>
                </div>

                {/* Composer */}
                <div className="flex items-end gap-2 px-4 pb-4 pt-3">
                  <button
                    type="button"
                    onClick={() => pushToast("error", "Voice input isn’t wired up yet.")}
                    className="inline-flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-2xl border"
                    style={{ borderColor: softBorder, color: "var(--foreground-muted)" }}
                    title="Voice message (coming soon)"
                  >
                    <Mic className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <textarea
                    ref={textareaRef}
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void sendMessage();
                      }
                    }}
                    rows={1}
                    placeholder="Type a command…  (Enter to send · Shift+Enter for a new line)"
                    className="field max-h-[168px] min-h-[44px] flex-1 resize-none overflow-y-auto rounded-2xl px-4 py-2.5 font-mono text-sm leading-6"
                  />
                  <button
                    type="button"
                    onClick={() => void sendMessage()}
                    disabled={!message.trim()}
                    className="button-primary inline-flex h-[44px] shrink-0 items-center gap-2 rounded-2xl px-4 text-sm font-semibold disabled:opacity-50"
                  >
                    <Send className="h-4 w-4" aria-hidden="true" />
                    Send
                  </button>
                </div>
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
                {treesLoading ? (
                  <Loader2 className="h-8 w-8 animate-spin" style={{ color: "var(--foreground-muted)" }} aria-hidden="true" />
                ) : (
                  <>
                    <TerminalSquare className="h-9 w-9" style={{ color: "var(--foreground-muted)" }} aria-hidden="true" />
                    <p className="mt-3 text-sm" style={{ color: "var(--foreground-muted)" }}>Select a terminal from the tree, or add one with the + buttons.</p>
                  </>
                )}
              </div>
            )}
          </section>

          {/* Command history / suggestions */}
          <aside className="surface-card hidden min-h-0 flex-col overflow-hidden rounded-[24px] lg:flex">
            <div
              className="flex items-center justify-between gap-2 border-b px-4 py-3"
              style={{ borderColor: "color-mix(in srgb, var(--card-border) 60%, transparent)" }}
            >
              <span className="inline-flex items-center gap-2 text-sm font-semibold">
                <History className="h-4 w-4" style={{ color: "var(--accent)" }} aria-hidden="true" />
                {message.trim() ? "Matches" : "History"}
              </span>
              <button
                type="button"
                onClick={() => selectedServerId !== null && void loadHistory(selectedServerId)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full border"
                style={{ borderColor: softBorder, color: "var(--foreground-muted)" }}
                title="Refresh history"
              >
                <RotateCw className={`h-3.5 w-3.5 ${historyLoading ? "animate-spin" : ""}`} aria-hidden="true" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
              {historyLoading && history.length === 0 ? (
                <p className="px-2 py-3 text-xs" style={{ color: "var(--foreground-muted)" }}>Loading history…</p>
              ) : suggestions.length === 0 ? (
                <p className="px-2 py-3 text-xs" style={{ color: "var(--foreground-muted)" }}>
                  {history.length === 0 ? "No zsh history found on this server." : "No matching commands."}
                </p>
              ) : (
                <ul className="space-y-0.5">
                  {suggestions.map((item, index) => (
                    <li key={`${item.command}-${index}`}>
                      <button
                        type="button"
                        onClick={() => applySuggestion(item.command)}
                        className="group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-[var(--accent-tint)]"
                        title={item.command}
                      >
                        <span className="min-w-0 flex-1 truncate font-mono text-xs" style={{ color: "var(--foreground)" }}>{item.command}</span>
                        {item.count > 1 ? (
                          <span className="shrink-0 rounded-full px-1.5 text-[10px]" style={{ backgroundColor: "color-mix(in srgb, var(--background-elevated) 90%, transparent)", color: "var(--foreground-muted)" }}>
                            ×{item.count}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
