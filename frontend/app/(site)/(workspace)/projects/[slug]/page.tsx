"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { get, post, socketUrl } from "@/app/utilities/api";
import { POLL_MS, detectChoices } from "@/app/utilities/tmux";
import { useProjectAi } from "@/app/utilities/project-ai-context";
import { useWorkspace } from "@/app/utilities/workspace-context";
import AgentPanel from "@/components/site/agent-panel";

const AGENT_MAX_LINES = 2000;
const AGENT_LINE_STEP = 150;

export default function ProjectAiPage() {
  const params = useParams<{ slug: string }>();
  const { getProjectBySlug, agentModels, pushToast } = useWorkspace();
  const project = getProjectBySlug(params.slug);
  const serverId = project?.server_id ?? null;
  const projectId = project?.id ?? null;

  const { prompt, setPrompt, model, setModel, clear, setClear, lines, setLines } = useProjectAi();

  const [target, setTarget] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState("");
  const [resolving, setResolving] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const choices = useMemo(() => detectChoices(snapshot), [snapshot]);
  const voiceUrl = useMemo(() => socketUrl("/planning/voice/stream", { target_language: "en", language_hints: "fa,en" }), []);

  const resolveSession = useCallback(async (sid: number, pid: number) => {
    setResolving(true);
    setError(null);
    try {
      const response = await get(`/planning/agent/session?server_id=${sid}&project_id=${pid}`);
      const data = await response.json().catch(() => ({ ok: false }));
      if (!response.ok || !data.ok) {
        setTarget(null);
        setError(data?.error ?? "Could not reach the server.");
        return;
      }
      setTarget(data.target ?? null);
    } catch {
      setTarget(null);
      setError("Could not reach the server.");
    } finally {
      setResolving(false);
    }
  }, []);

  const loadSnapshot = useCallback(async (sid: number, pane: string, count: number) => {
    try {
      const response = await get(`/planning/servers/${sid}/capture?target=${encodeURIComponent(pane)}&lines=${count}`);
      const data = await response.json().catch(() => ({ ok: false }));
      if (response.ok && data.ok) setSnapshot(data.text ?? "");
    } catch {
      // Transient capture failures leave the last frame on screen.
    }
  }, []);

  // Resolve the Claude session for this project on mount.
  useEffect(() => {
    if (serverId === null || projectId === null) return;
    void resolveSession(serverId, projectId);
  }, [serverId, projectId, resolveSession]);

  // Mirror the agent's pane.
  useEffect(() => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (serverId === null || !target) return;
    const sid = serverId;
    const pane = target;
    void loadSnapshot(sid, pane, lines);
    pollRef.current = window.setInterval(() => void loadSnapshot(sid, pane, lines), POLL_MS);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [serverId, target, lines, loadSnapshot]);

  async function sendKey(key: string) {
    if (serverId === null || !target) return;
    const sid = serverId;
    const pane = target;
    try {
      const response = await post(`/planning/servers/${sid}/send-key`, { target: pane, key });
      const data = await response.json().catch(() => ({ ok: false }));
      if (!response.ok || !data.ok) {
        pushToast("error", data?.error ?? "Could not send key");
        return;
      }
      window.setTimeout(() => void loadSnapshot(sid, pane, lines), 250);
    } catch {
      pushToast("error", "Could not send key");
    }
  }

  async function runAgent() {
    if (serverId === null || projectId === null || !prompt.trim() || sending) return;
    const sid = serverId;
    setSending(true);
    setError(null);
    try {
      const response = await post("/planning/agent/run", { server_id: sid, project_id: projectId, prompt, clear, model });
      const data = await response.json().catch(() => ({ ok: false }));
      if (!response.ok || !data.ok) {
        setError(data?.error ?? data?.detail ?? "Could not reach Claude.");
        return;
      }
      setPrompt("");
      setClear(false);
      setTarget(data.target ?? null);
      if (data.created) pushToast("success", "Started Claude in a new terminal.");
    } catch {
      setError("Could not reach Claude.");
    } finally {
      setSending(false);
    }
  }

  return (
    <AgentPanel
      title={project?.name ?? "Claude"}
      subtitle={project?.root_path ?? project?.server_host ?? ""}
      models={agentModels}
      model={model}
      onModelChange={setModel}
      clear={clear}
      onClearChange={setClear}
      prompt={prompt}
      onPromptChange={setPrompt}
      onSend={() => void runAgent()}
      sending={sending}
      target={target}
      snapshot={snapshot}
      resolving={resolving}
      error={error}
      onRefresh={() => serverId !== null && projectId !== null && void resolveSession(serverId, projectId)}
      lines={lines}
      onLoadMore={() => setLines(Math.min(lines + AGENT_LINE_STEP, AGENT_MAX_LINES))}
      canLoadMore={lines < AGENT_MAX_LINES}
      voiceUrl={voiceUrl}
      onVoiceError={(text) => pushToast("error", text)}
      choices={choices}
      onKey={(key) => void sendKey(key)}
    />
  );
}
