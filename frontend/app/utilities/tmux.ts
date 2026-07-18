// Shared types, helpers and constants for the tmux/terminal + agent features.
// Extracted from the old monolithic terminals page so both the terminals
// navigator and the project detail page can reuse them. Pure functions only —
// no React, no API calls.

export type Server = { id: number; name: string; host: string; port: number };

export type Pane = { index: number; active: boolean; command: string; title: string; current_path: string };
export type Win = { index: number; name: string; active: boolean; panes_count: number; panes: Pane[] };
export type Session = { name: string; windows_count: number; activity: number; attached: boolean; windows: Win[] };

export type Project = { id: number; name: string; server_id: number | null; root_path: string | null };

export type HistoryItem = { command: string; count: number };

// Server overview (services / cronjobs / disk).
export type ServiceInfo = { name: string; state: string; description: string; scope: string };
export type DiskInfo = { filesystem: string; size: string; used: string; avail: string; use_percent: string; mounted_on: string };
export type ServerOverview = { services: ServiceInfo[]; cronjobs: string[]; disk: DiskInfo[] };

// Project overview (AGENTS.md + git changes).
export type ChangedFile = { status: string; path: string };
export type ProjectOverview = { has_root: boolean; is_git: boolean; agents_md: string | null; changed_files: ChangedFile[] };

// A model the Claude Code CLI accepts for --model / /model.
export type AgentModel = { id: string; label: string; hint: string; description: string };

// One terminal (tmux pane) in the tree, plus the display label to show for it.
// `label` is the human title (pane title, falling back to the session name).
export type PaneRef = { session: Session; win: Win; pane: Pane; target: string; label: string };
export type PaneGroup = { key: string; label: string; project: Project | null; panes: PaneRef[] };

// How often to re-capture a live pane, in ms.
export const POLL_MS = 1200;
// Scrollback the expanded terminal starts with, and the steps "Load more" walks.
export const DEFAULT_CAPTURE_LINES = 50;
export const CAPTURE_LINE_STEPS = [50, 200, 500, 2000];
// How much scrollback a preview card pulls (we then show only its last few lines).
export const PREVIEW_CAPTURE_LINES = 40;
export const PREVIEW_VISIBLE_LINES = 6;

export function timeAgo(epochSeconds: number): string {
  if (!epochSeconds) return "unknown";
  const diff = Math.max(0, Math.floor(Date.now() / 1000 - epochSeconds));
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// Is `paneCwd` inside project root `root`? Tolerant of how the root was typed:
// trailing slashes, a leading "~", or a relative path all still match against
// tmux's absolute pane_current_path by comparing the normalized tail.
export function pathUnder(paneCwd: string | null | undefined, root: string | null | undefined): boolean {
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
export function matchProject(path: string | null | undefined, projects: Project[], serverId: number | null): Project | null {
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
export function buildPaneGroups(sessions: Session[], projects: Project[], serverId: number): PaneGroup[] {
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
    for (const win of session.windows) {
      for (const pane of win.panes) {
        const project = matchProject(pane.current_path, projects, serverId);
        const group = ensure(project ? `p-${project.id}` : "other", project ? project.name : "Other", project);
        const target = `${session.name}:${win.index}.${pane.index}`;
        const label = pane.title?.trim() || session.name;
        group.panes.push({ session, win, pane, target, label });
      }
    }
  }
  const groups = order.filter((key) => key !== "other").map((key) => map.get(key)!);
  const other = map.get("other");
  if (other) groups.push(other);
  return groups;
}

// Collect this project's panes (terminals) across all sessions on its server,
// each with a stable tmux target and a display label.
export function projectPanes(sessions: Session[], project: Project): PaneRef[] {
  if (project.server_id === null) return [];
  const groups = buildPaneGroups(sessions, [project], project.server_id);
  const group = groups.find((candidate) => candidate.project?.id === project.id);
  return group?.panes ?? [];
}

const ANSI_PATTERN = /\x1b\[[0-9;?]*[A-Za-z]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

// The last few non-blank lines of a capture, plain (no ANSI) — for previews.
export function lastLines(snapshot: string, count = PREVIEW_VISIBLE_LINES): string {
  const lines = stripAnsi(snapshot).replace(/\s+$/, "").split("\n");
  const trimmed: string[] = [];
  for (let i = lines.length - 1; i >= 0 && trimmed.length < count; i -= 1) {
    trimmed.unshift(lines[i]);
  }
  while (trimmed.length > 1 && trimmed[0].trim() === "") trimmed.shift();
  return trimmed.join("\n");
}

// Claude Code asks for a decision by printing a numbered menu, usually inside a
// drawn box, so the leading and trailing border glyphs have to be tolerated:
//     │ ❯ 1. Yes                                   │
//     │   2. No, and tell Claude what to do (esc)  │
const CHOICE_PATTERN = /^[\s│┃|╎┆╷]*[❯>»➤]?\s*([1-9])[.)]\s+(.+?)\s*[│┃|]?\s*$/;

// Spot that menu near the bottom of the pane so the numbers can be offered as
// taps. Two or more entries are required — a lone "1." is far more likely to be
// ordinary output than a question.
export function detectChoices(snapshot: string): Array<{ key: string; label: string }> {
  const found = new Map<string, string>();
  for (const line of stripAnsi(snapshot).split("\n").slice(-30)) {
    const match = CHOICE_PATTERN.exec(line);
    if (match) found.set(match[1], match[2]);
  }
  if (found.size < 2) return [];
  return [...found.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, label]) => ({ key, label }));
}

// Colour a git porcelain status code: added=green, deleted=red, modified/renamed=accent.
export function gitStatusColor(status: string): string {
  if (status.includes("A")) return "var(--success)";
  if (status.includes("D")) return "var(--danger)";
  if (status.includes("M") || status.includes("R")) return "var(--accent)";
  return "var(--foreground-muted)";
}

export const softBorder = "color-mix(in srgb, var(--card-border) 70%, transparent)";
export const panelHeaderBorder = { borderColor: "color-mix(in srgb, var(--card-border) 60%, transparent)" };
