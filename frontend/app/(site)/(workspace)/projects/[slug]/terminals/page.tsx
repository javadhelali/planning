"use client";

import { Loader2, Plus, TerminalSquare } from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { get, post } from "@/app/utilities/api";
import {
  DEFAULT_CAPTURE_LINES,
  POLL_MS,
  PREVIEW_CAPTURE_LINES,
  lastLines,
  projectPanes,
  type Session,
} from "@/app/utilities/tmux";
import { useWorkspace } from "@/app/utilities/workspace-context";
import TerminalPreview from "@/components/site/terminal-preview";
import TerminalView from "@/components/site/terminal-view";

export default function ProjectTerminalsPage() {
  const params = useParams<{ slug: string }>();
  const { getProjectBySlug, pushToast } = useWorkspace();
  const project = getProjectBySlug(params.slug);
  const serverId = project?.server_id ?? null;

  const projectRef = useMemo(
    () => (project ? { id: project.id, name: project.name, server_id: project.server_id, root_path: project.root_path } : null),
    [project],
  );

  const [sessions, setSessions] = useState<Session[]>([]);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [treeLoading, setTreeLoading] = useState(true);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [previewsLoading, setPreviewsLoading] = useState(false);

  const [activeTarget, setActiveTarget] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState("");
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(true);
  const [historyLines, setHistoryLines] = useState(DEFAULT_CAPTURE_LINES);
  const pollRef = useRef<number | null>(null);

  const panes = useMemo(() => (projectRef ? projectPanes(sessions, projectRef) : []), [sessions, projectRef]);
  const activePane = useMemo(() => panes.find((ref) => ref.target === activeTarget) ?? null, [panes, activeTarget]);

  const loadTree = useCallback(
    async (sid: number, ref: { id: number; name: string; server_id: number | null; root_path: string | null }) => {
      setTreeLoading(true);
      try {
        const response = await get(`/planning/servers/${sid}/sessions`);
        const data = await response.json().catch(() => ({ ok: false, error: "Bad response" }));
        if (!response.ok || !data.ok) {
          setSessions([]);
          setTreeError(data?.error ?? "Could not reach the server.");
          return;
        }
        const list: Session[] = data.sessions ?? [];
        setSessions(list);
        setTreeError(null);

        const refs = projectPanes(list, ref);
        setPreviewsLoading(true);
        void Promise.all(
          refs.map(async (paneRef) => {
            try {
              const capture = await get(`/planning/servers/${sid}/capture?target=${encodeURIComponent(paneRef.target)}&lines=${PREVIEW_CAPTURE_LINES}`);
              const captureData = await capture.json().catch(() => ({ ok: false }));
              if (capture.ok && captureData.ok) setPreviews((current) => ({ ...current, [paneRef.target]: lastLines(captureData.text ?? "") }));
            } catch {
              // Leave this preview blank.
            }
          }),
        ).finally(() => setPreviewsLoading(false));
      } catch {
        setSessions([]);
        setTreeError("Could not reach the server.");
      } finally {
        setTreeLoading(false);
      }
    },
    [],
  );

  const loadSnapshot = useCallback(async (sid: number, pane: string, count: number) => {
    try {
      const linesParam = count > 0 ? `&lines=${count}` : "";
      const response = await get(`/planning/servers/${sid}/capture?target=${encodeURIComponent(pane)}${linesParam}`);
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
  }, []);

  // Load the terminal tree on mount / project change.
  useEffect(() => {
    if (serverId === null || !projectRef) return;
    void loadTree(serverId, projectRef);
  }, [serverId, projectRef, loadTree]);

  // Poll the expanded pane while it's open and live.
  useEffect(() => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (serverId === null || !isLive || !activeTarget) return;
    const sid = serverId;
    const pane = activeTarget;
    void loadSnapshot(sid, pane, historyLines);
    pollRef.current = window.setInterval(() => void loadSnapshot(sid, pane, historyLines), POLL_MS);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [serverId, isLive, activeTarget, historyLines, loadSnapshot]);

  // Collapse if the expanded pane vanished.
  useEffect(() => {
    if (activeTarget && !panes.some((ref) => ref.target === activeTarget)) {
      setActiveTarget(null);
      setSnapshot("");
      setSnapshotError(null);
    }
  }, [panes, activeTarget]);

  function openPane(pane: string) {
    setActiveTarget(pane);
    setSnapshot("");
    setSnapshotError(null);
    setHistoryLines(DEFAULT_CAPTURE_LINES);
    setIsLive(true);
  }

  async function sendKey(key: string) {
    if (serverId === null || !activeTarget) return;
    const sid = serverId;
    const pane = activeTarget;
    try {
      const response = await post(`/planning/servers/${sid}/send-key`, { target: pane, key });
      const data = await response.json().catch(() => ({ ok: false }));
      if (!response.ok || !data.ok) {
        pushToast("error", data?.error ?? "Could not send key");
        return;
      }
      window.setTimeout(() => void loadSnapshot(sid, pane, historyLines), 250);
    } catch {
      pushToast("error", "Could not send key");
    }
  }

  async function sendText(text: string) {
    if (serverId === null || !activeTarget || !text.trim()) return;
    const sid = serverId;
    const pane = activeTarget;
    try {
      const response = await post(`/planning/servers/${sid}/send-text`, { target: pane, text, enter: true });
      const data = await response.json().catch(() => ({ ok: false }));
      if (!response.ok || !data.ok) {
        pushToast("error", data?.error ?? "Could not send text");
        return;
      }
      window.setTimeout(() => void loadSnapshot(sid, pane, historyLines), 250);
    } catch {
      pushToast("error", "Could not send text");
    }
  }

  async function exitPane() {
    if (serverId === null || !activeTarget || !projectRef) return;
    const sid = serverId;
    const ref = projectRef;
    await sendKey("C-d");
    setActiveTarget(null);
    window.setTimeout(() => void loadTree(sid, ref), 500);
  }

  async function newTerminal() {
    if (serverId === null || !project || !projectRef) return;
    const sid = serverId;
    const existing = new Set(sessions.map((session) => session.name));
    const clean = project.name.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/^-+|-+$/g, "") || "term";
    let name = clean;
    let index = 2;
    while (existing.has(name)) name = `${clean}-${index++}`;
    try {
      const response = await post(`/planning/servers/${sid}/sessions`, { name, cwd: project.root_path ?? null });
      const data = await response.json().catch(() => ({ ok: false }));
      if (!response.ok || !data.ok) {
        pushToast("error", data?.error ?? "Could not create session");
        return;
      }
      pushToast("success", `Created terminal "${name}"`);
      await loadTree(sid, projectRef);
      openPane(`${name}:0.0`);
    } catch {
      pushToast("error", "Could not create session");
    }
  }

  if (activeTarget && activePane) {
    return (
      <TerminalView
        key={activeTarget}
        target={activeTarget}
        badge={project?.name ?? null}
        snapshot={snapshot}
        snapshotError={snapshotError}
        isLive={isLive}
        onToggleLive={() => setIsLive((value) => !value)}
        historyLines={historyLines}
        onSetLines={setHistoryLines}
        onRefresh={() => serverId !== null && void loadSnapshot(serverId, activeTarget, historyLines)}
        onSendKey={(key) => void sendKey(key)}
        onSendText={(text) => void sendText(text)}
        onExit={() => void exitPane()}
        onClose={() => setActiveTarget(null)}
      />
    );
  }

  return (
    <section className="surface-card flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[24px]">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5" style={{ borderColor: "color-mix(in srgb, var(--card-border) 60%, transparent)" }}>
        <span className="inline-flex items-center gap-2 text-sm font-semibold">
          Terminals
          {(treeLoading || previewsLoading) ? <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: "var(--foreground-muted)" }} aria-hidden="true" /> : null}
        </span>
        <button type="button" onClick={() => void newTerminal()} className="button-primary inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold">
          <Plus className="h-3.5 w-3.5" aria-hidden="true" /> New terminal
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {treeError ? (
          <p className="text-sm" style={{ color: "var(--danger)" }}>{treeError}</p>
        ) : treeLoading && panes.length === 0 ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-7 w-7 animate-spin" style={{ color: "var(--foreground-muted)" }} aria-hidden="true" /></div>
        ) : panes.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <TerminalSquare className="h-9 w-9" style={{ color: "var(--foreground-muted)" }} aria-hidden="true" />
            <p className="mt-3 text-sm" style={{ color: "var(--foreground-muted)" }}>No terminals in this project yet. Start one with “New terminal”.</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {panes.map((ref) => (
              <TerminalPreview key={ref.target} pane={ref} preview={previews[ref.target]} loading={previewsLoading} onOpen={() => openPane(ref.target)} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
