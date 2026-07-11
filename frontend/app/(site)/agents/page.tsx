"use client";

import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bell,
  BellOff,
  Bot,
  CheckCircle2,
  CircleStop,
  CornerDownLeft,
  FolderGit2,
  Info,
  Loader2,
  OctagonAlert,
  PauseCircle,
  Plus,
  RotateCw,
  Send,
  Server as ServerIcon,
  Square,
  TerminalSquare,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { hasPlanningSession } from "../../utilities/api";
import Modal from "@/components/site/modal";
import ToastStack from "@/components/site/toast-stack";
import MetaItem from "@/components/site/meta-item";

type AuthState = "checking" | "authenticated" | "guest";
type AgentType = "codex" | "claude";
// Only states we can read reliably from tmux: the screen is moving (working),
// the screen has gone static (idle — a hint, not a claim), or the session ended.
type RunStatus = "working" | "idle" | "finished" | "failed";

type AgentRun = {
  id: string;
  title: string;
  project: string;
  server: string;
  rootPath: string;
  agent: AgentType;
  status: RunStatus;
  tmuxSession: string;
  updatedAgo: string;
  idleFor?: string; // shown when status === "idle"
  snapshot: string;
};

type ToastMessage = { id: number; type: "success" | "error"; message: string };

const STATUS_META: Record<
  RunStatus,
  { label: string; color: string; tint: string; icon: typeof CheckCircle2; spin?: boolean }
> = {
  working: { label: "Working", color: "var(--accent)", tint: "var(--accent-tint)", icon: Loader2, spin: true },
  idle: {
    label: "Idle",
    color: "var(--foreground-muted)",
    tint: "color-mix(in srgb, var(--foreground-muted) 16%, transparent)",
    icon: PauseCircle,
  },
  finished: { label: "Finished", color: "var(--success)", tint: "var(--success-tint)", icon: CheckCircle2 },
  failed: { label: "Failed", color: "var(--danger)", tint: "var(--danger-tint)", icon: OctagonAlert },
};

const MOCK_RUNS: AgentRun[] = [
  {
    id: "run_1",
    title: "Refactor the search module",
    project: "trading",
    server: "amin",
    rootPath: "/app/code/trading",
    agent: "codex",
    status: "idle",
    tmuxSession: "trading-1",
    updatedAgo: "8s ago",
    idleFor: "8s",
    snapshot: `● I'll refactor the search module. Planned changes:
    1. Extract the query builder into search/query.py
    2. Add cursor-based pagination to list endpoints
    3. Backfill tests for the new query paths

  Diff preview (search/query.py):
    + class QueryBuilder:
    +     def paginate(self, cursor: str | None, limit: int = 50):
    +         ...

┌───────────────────────────────────────────────────────────┐
│  Apply this change to search/query.py?                     │
│                                                            │
│  ❯ Yes                                                     │
│    Yes, and don't ask again this session                   │
│    No, tell Codex what to do differently                   │
└───────────────────────────────────────────────────────────┘`,
  },
  {
    id: "run_2",
    title: "Add dark-mode polish to the dashboard",
    project: "market-ui",
    server: "amin",
    rootPath: "/app/code/market/market-ui",
    agent: "claude",
    status: "working",
    tmuxSession: "market-ui-1",
    updatedAgo: "just now",
    snapshot: `⏺ Reading components/dashboard/Header.tsx …
⏺ Editing components/dashboard/Header.tsx
   Updated 3 blocks · +18 −6

⏺ Running: npm run lint
   ⠋ working…  (12s)

  esc to interrupt · the agent is actively editing files`,
  },
  {
    id: "run_3",
    title: "Write a backup script for postgres volumes",
    project: "shop-tools",
    server: "hetzner-1",
    rootPath: "/app/code/shop-tools",
    agent: "codex",
    status: "finished",
    tmuxSession: "shop-tools-1",
    updatedAgo: "6m ago",
    snapshot: `● Done. Created scripts/backup_pg.sh and wired a @daily cron.
  - Dumps every planning-* database with --clean --if-exists
  - Keeps 7 daily / 4 weekly copies under /app/backups

  Summary: 2 files changed, 74 insertions(+)
  The task is complete. Shell returned to prompt.

user@hetzner-1:/app/code/shop-tools$ ▮`,
  },
  {
    id: "run_4",
    title: "Migrate marketplace to the new auth flow",
    project: "marketplace",
    server: "hetzner-1",
    rootPath: "/app/code/marketplace",
    agent: "claude",
    status: "failed",
    tmuxSession: "marketplace-1",
    updatedAgo: "22m ago",
    snapshot: `⏺ Running: pytest tests/auth
   ...
   E   ModuleNotFoundError: No module named 'authlib'

✗ The session exited unexpectedly (command not found).
  The agent process is no longer running in this pane.`,
  },
];

const QUICK_KEYS: Array<{ key: string; label: string; icon?: typeof ArrowUp }> = [
  { key: "Enter", label: "Enter", icon: CornerDownLeft },
  { key: "Up", label: "Up", icon: ArrowUp },
  { key: "Down", label: "Down", icon: ArrowDown },
  { key: "Left", label: "Left", icon: ArrowLeft },
  { key: "Right", label: "Right", icon: ArrowRight },
  { key: "Escape", label: "Esc" },
  { key: "y", label: "y" },
  { key: "n", label: "n" },
  { key: "C-c", label: "Ctrl-C", icon: CircleStop },
];

function StatusChip({ status }: { status: RunStatus }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ backgroundColor: meta.tint, color: meta.color }}
    >
      <Icon className={`h-3.5 w-3.5 ${meta.spin ? "animate-spin" : ""}`} aria-hidden="true" />
      {meta.label}
    </span>
  );
}

function AgentBadge({ agent }: { agent: AgentType }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide"
      style={{ backgroundColor: "color-mix(in srgb, var(--background-elevated) 90%, transparent)", color: "var(--foreground-muted)" }}
    >
      <Bot className="h-3 w-3" aria-hidden="true" />
      {agent}
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
          Agents
        </span>
        <h1 className="mt-5 max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Run coding agents on your projects and watch them live.
        </h1>
        <p className="mt-4 max-w-xl text-base leading-7" style={{ color: "var(--foreground-muted)" }}>
          Sign in to start agent runs on your servers, view their live terminal, and send keys into their tmux session.
        </p>
        <Link href="/login" className="button-primary mt-8 inline-flex rounded-full px-5 py-3 text-sm font-semibold">
          Sign in to your workspace
        </Link>
      </section>
    </div>
  );
}

export default function AgentsPage() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [runs] = useState<AgentRun[]>(MOCK_RUNS);
  const [selectedId, setSelectedId] = useState<string>(MOCK_RUNS[0].id);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [isLive, setIsLive] = useState(true);
  const [notifyOnIdle, setNotifyOnIdle] = useState(true);
  const [message, setMessage] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newProject, setNewProject] = useState("trading");
  const [newAgent, setNewAgent] = useState<AgentType>("codex");
  const [newPrompt, setNewPrompt] = useState("");

  useEffect(() => {
    setAuthState(hasPlanningSession() ? "authenticated" : "guest");
  }, []);

  const selected = useMemo(() => runs.find((run) => run.id === selectedId) ?? runs[0], [runs, selectedId]);

  function pushToast(type: ToastMessage["type"], text: string) {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, type, message: text }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 3500);
  }

  function dismissToast(id: number) {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }

  function sendKey(key: string) {
    pushToast("success", `Preview: would send key "${key}" to ${selected.tmuxSession}`);
  }

  function sendMessage() {
    if (!message.trim()) return;
    pushToast("success", `Preview: would type into ${selected.tmuxSession} and press Enter`);
    setMessage("");
  }

  if (authState === "checking") {
    return <div className="skeleton h-64 rounded-[28px]" />;
  }
  if (authState === "guest") {
    return <GuestHome />;
  }

  const isActive = selected.status === "working" || selected.status === "idle";

  return (
    <div className="flex min-h-[calc(100vh-112px)] min-w-0 flex-col gap-6">
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      {/* Preview banner */}
      <div
        className="flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm"
        style={{ backgroundColor: "var(--accent-tint)", color: "var(--accent)" }}
      >
        <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>Design preview — mock data. Buttons show what would happen; nothing is sent to a server yet.</span>
      </div>

      {/* Header */}
      <section className="flex flex-col gap-3 px-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Agents</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 sm:text-base" style={{ color: "var(--foreground-muted)" }}>
            A live window into the tmux sessions on your servers. Watch the screen, read what the agent is doing, and send
            keys — exactly as if you had run <span className="font-mono text-[0.85em]">tmux attach</span> yourself.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsCreateOpen(true)}
          className="button-primary inline-flex h-11 items-center gap-2 self-start rounded-full px-4 text-sm font-semibold md:self-auto"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          New agent run
        </button>
      </section>

      {/* Master–detail */}
      <div className="grid min-w-0 flex-1 gap-5 lg:grid-cols-[minmax(300px,360px)_minmax(0,1fr)]">
        {/* List */}
        <aside className="flex min-w-0 flex-col gap-3">
          {runs.map((run) => {
            const active = run.id === selected.id;
            return (
              <button
                key={run.id}
                type="button"
                onClick={() => setSelectedId(run.id)}
                className="surface-card rounded-[24px] p-4 text-left transition"
                style={{
                  outline: active ? "2px solid var(--accent)" : "2px solid transparent",
                  boxShadow: active ? "var(--shadow-3)" : undefined,
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 truncate text-sm font-semibold">{run.title}</p>
                  <StatusChip status={run.status} />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: "var(--foreground-muted)" }}>
                  <MetaItem icon={<FolderGit2 className="h-3.5 w-3.5" aria-hidden="true" />}>{run.project}</MetaItem>
                  <MetaItem icon={<ServerIcon className="h-3.5 w-3.5" aria-hidden="true" />}>{run.server}</MetaItem>
                  <MetaItem icon={<TerminalSquare className="h-3.5 w-3.5" aria-hidden="true" />}>{run.tmuxSession}</MetaItem>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <AgentBadge agent={run.agent} />
                  <span className="text-xs" style={{ color: "var(--foreground-muted)" }}>
                    {run.status === "idle" && run.idleFor ? `idle ${run.idleFor}` : run.updatedAgo}
                  </span>
                </div>
              </button>
            );
          })}
        </aside>

        {/* Detail */}
        <section className="surface-card flex min-w-0 flex-col rounded-[28px]">
          {/* Detail header */}
          <div className="flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: "color-mix(in srgb, var(--card-border) 60%, transparent)" }}>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="truncate text-lg font-semibold">{selected.title}</h3>
                <StatusChip status={selected.status} />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: "var(--foreground-muted)" }}>
                <MetaItem icon={<FolderGit2 className="h-3.5 w-3.5" aria-hidden="true" />}>{selected.project}</MetaItem>
                <MetaItem icon={<ServerIcon className="h-3.5 w-3.5" aria-hidden="true" />}>{selected.server}</MetaItem>
                <MetaItem icon={<TerminalSquare className="h-3.5 w-3.5" aria-hidden="true" />}>
                  tmux attach -t {selected.tmuxSession}
                </MetaItem>
                <AgentBadge agent={selected.agent} />
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setNotifyOnIdle((value) => !value)}
                className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium"
                style={{
                  borderColor: "color-mix(in srgb, var(--card-border) 70%, transparent)",
                  color: notifyOnIdle ? "var(--accent)" : "var(--foreground-muted)",
                }}
                title="Notify me when a run stops moving (goes idle)"
              >
                {notifyOnIdle ? <Bell className="h-3.5 w-3.5" aria-hidden="true" /> : <BellOff className="h-3.5 w-3.5" aria-hidden="true" />}
                Notify on idle
              </button>
              <button
                type="button"
                onClick={() => setIsLive((value) => !value)}
                className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium"
                style={{
                  borderColor: "color-mix(in srgb, var(--card-border) 70%, transparent)",
                  color: isLive ? "var(--success)" : "var(--foreground-muted)",
                }}
              >
                <span className="relative flex h-2 w-2">
                  {isLive ? <span className="absolute inline-flex h-full w-full animate-ping rounded-full" style={{ backgroundColor: "var(--success)", opacity: 0.6 }} /> : null}
                  <span className="relative inline-flex h-2 w-2 rounded-full" style={{ backgroundColor: isLive ? "var(--success)" : "var(--foreground-muted)" }} />
                </span>
                {isLive ? "Live" : "Paused"}
              </button>
              <button
                type="button"
                onClick={() => pushToast("success", "Preview: would re-capture the pane now")}
                className="button-secondary inline-flex h-9 w-9 items-center justify-center rounded-full"
                title="Refresh snapshot"
              >
                <RotateCw className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Terminal snapshot */}
          <div className="px-5 pt-4">
            <div className="flex items-center justify-between px-1 pb-2 text-xs" style={{ color: "var(--foreground-muted)" }}>
              <span>Live terminal · 200×50</span>
              <span>{selected.status === "idle" && selected.idleFor ? `screen static for ${selected.idleFor}` : `updated ${selected.updatedAgo}`}</span>
            </div>
            <div className="overflow-x-auto rounded-2xl" style={{ backgroundColor: "#0c0f14", border: "1px solid #232a33" }}>
              <pre
                className="min-w-[520px] px-4 py-4 text-[12.5px] leading-[1.5]"
                style={{ fontFamily: "var(--font-mono)", color: "#d6dde6", whiteSpace: "pre" }}
              >
                {selected.snapshot}
              </pre>
            </div>
          </div>

          {/* Idle hint — honest: we know it stopped, not why */}
          {selected.status === "idle" ? (
            <div className="px-5 pt-3">
              <div
                className="flex items-start gap-2 rounded-2xl px-3.5 py-2.5 text-xs leading-5"
                style={{ backgroundColor: "color-mix(in srgb, var(--foreground-muted) 12%, transparent)", color: "var(--foreground-muted)" }}
              >
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>
                  This run has gone <strong>idle</strong> — the screen stopped changing. It may be waiting for input or just
                  finished thinking. Read the screen above and respond with the keys below.
                </span>
              </div>
            </div>
          ) : null}

          {/* Composer + keys */}
          <div className="mt-auto px-5 pb-5 pt-4">
            <div className="flex flex-wrap items-center gap-1.5 pb-3">
              {QUICK_KEYS.map((quick) => {
                const Icon = quick.icon;
                return (
                  <button
                    key={quick.key}
                    type="button"
                    onClick={() => sendKey(quick.key)}
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
                    sendMessage();
                  }
                }}
                rows={2}
                placeholder={`Type a message to the ${selected.agent} agent…  (⌘/Ctrl + Enter to send)`}
                className="field min-h-[52px] flex-1 rounded-2xl px-4 py-3 text-sm"
              />
              <button
                type="button"
                onClick={sendMessage}
                disabled={!message.trim()}
                className="button-primary inline-flex h-[52px] items-center gap-2 rounded-2xl px-4 text-sm font-semibold disabled:opacity-50"
              >
                <Send className="h-4 w-4" aria-hidden="true" />
                Send
              </button>
            </div>

            {/* Lifecycle actions */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {isActive ? (
                <button
                  type="button"
                  onClick={() => pushToast("success", "Preview: would send Ctrl-C then kill the tmux session")}
                  className="button-danger inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold"
                >
                  <Square className="h-4 w-4" aria-hidden="true" />
                  Stop run
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => pushToast("success", "Preview: would remove this run from the list")}
                  className="button-secondary inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                  Dismiss
                </button>
              )}
            </div>
          </div>
        </section>
      </div>

      {/* New run modal */}
      <Modal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="New agent run"
        description="Start a coding agent inside a tmux session on the project's server."
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setIsCreateOpen(false);
            pushToast("success", `Preview: would start ${newAgent} on "${newProject}" in a new tmux session`);
            setNewPrompt("");
          }}
          className="space-y-4"
        >
          <div>
            <label htmlFor="new-project" className="text-sm font-semibold">Project</label>
            <select
              id="new-project"
              value={newProject}
              onChange={(event) => setNewProject(event.target.value)}
              className="field mt-2 rounded-2xl px-4 py-3 text-sm"
            >
              {["trading", "market-ui", "shop-tools", "marketplace"].map((project) => (
                <option key={project} value={project}>{project}</option>
              ))}
            </select>
            <p className="mt-1.5 text-xs" style={{ color: "var(--foreground-muted)" }}>
              The project determines the server and the folder the agent runs in.
            </p>
          </div>

          <div>
            <span className="text-sm font-semibold">Agent</span>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(["codex", "claude"] as AgentType[]).map((agent) => {
                const active = newAgent === agent;
                return (
                  <button
                    key={agent}
                    type="button"
                    onClick={() => setNewAgent(agent)}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-semibold capitalize"
                    style={{
                      borderColor: active ? "var(--accent)" : "color-mix(in srgb, var(--card-border) 70%, transparent)",
                      backgroundColor: active ? "var(--accent-tint)" : "transparent",
                      color: active ? "var(--accent)" : "var(--foreground)",
                    }}
                  >
                    <Bot className="h-4 w-4" aria-hidden="true" />
                    {agent}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label htmlFor="new-prompt" className="text-sm font-semibold">Initial prompt / task</label>
            <textarea
              id="new-prompt"
              value={newPrompt}
              onChange={(event) => setNewPrompt(event.target.value)}
              rows={4}
              placeholder="e.g. Refactor the search module and add pagination."
              className="field mt-2 rounded-2xl px-4 py-3 text-sm"
            />
            <p className="mt-1.5 text-xs" style={{ color: "var(--foreground-muted)" }}>
              Sent to the agent as the first message once its TUI is up.
            </p>
          </div>

          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setIsCreateOpen(false)} className="button-secondary rounded-2xl px-4 py-3 text-sm font-medium">
              Cancel
            </button>
            <button type="submit" className="button-primary inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold">
              <Bot className="h-4 w-4" aria-hidden="true" />
              Start run
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
