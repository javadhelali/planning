"use client";

import { Globe, KeyRound, PencilLine, Plus, Server as ServerIcon, Terminal, Trash2 } from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { get } from "@/app/utilities/api";
import { softBorder, type ServerOverview } from "@/app/utilities/tmux";
import { useWorkspace } from "@/app/utilities/workspace-context";
import ServerOverviewPanel from "@/components/site/server-overview";

export default function ServerPage() {
  const params = useParams<{ id: string }>();
  const serverId = Number(params.id);
  const { getServer, loading: workspaceLoading, openEditServer, promptDeleteServer, openCreateProject } = useWorkspace();
  const server = getServer(serverId);

  const [overview, setOverview] = useState<ServerOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOverview = useCallback(async (id: number) => {
    setLoading(true);
    setError(null);
    try {
      const response = await get(`/planning/servers/${id}/overview`);
      const data = await response.json().catch(() => ({ ok: false }));
      if (!response.ok || !data.ok) {
        setOverview(null);
        setError(data?.error ?? "Could not load server overview.");
        return;
      }
      setOverview({ services: data.services ?? [], cronjobs: data.cronjobs ?? [], disk: data.disk ?? [] });
    } catch {
      setOverview(null);
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (Number.isNaN(serverId)) return;
    void loadOverview(serverId);
  }, [serverId, loadOverview]);

  if (!server) {
    return (
      <div className="surface-card flex min-h-0 flex-1 items-center justify-center rounded-[24px] py-16">
        <p className="text-sm" style={{ color: "var(--foreground-muted)" }}>{workspaceLoading ? "Loading…" : "Server not found."}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Server actions */}
      <div className="surface-card flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[20px] px-4 py-3">
        <ServerIcon className="h-4 w-4 shrink-0" style={{ color: "var(--foreground-muted)" }} aria-hidden="true" />
        <span className="text-sm font-semibold">{server.name}</span>
        <span className="inline-flex items-center gap-1 font-mono text-xs" style={{ color: "var(--foreground-muted)" }}>
          <Globe className="h-3.5 w-3.5" aria-hidden="true" /> {server.host}:{server.port}
        </span>
        {server.username ? (
          <span className="inline-flex items-center gap-1 text-xs" style={{ color: "var(--foreground-muted)" }}>
            <Terminal className="h-3.5 w-3.5" aria-hidden="true" /> {server.username}
          </span>
        ) : null}
        <span className="inline-flex items-center gap-1 text-xs" style={{ color: "var(--foreground-muted)" }}>
          <KeyRound className="h-3.5 w-3.5" aria-hidden="true" /> {server.key_path || "default key"}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <button type="button" onClick={() => openCreateProject(server.id)} className="button-primary inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold">
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Project
          </button>
          <button type="button" onClick={() => openEditServer(server)} className="inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium" style={{ borderColor: softBorder, color: "var(--foreground-muted)" }}>
            <PencilLine className="h-3.5 w-3.5" aria-hidden="true" /> Edit
          </button>
          <button type="button" onClick={() => promptDeleteServer(server)} className="inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium" style={{ borderColor: "color-mix(in srgb, var(--danger) 40%, transparent)", color: "var(--danger)" }}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Delete
          </button>
        </div>
      </div>

      <ServerOverviewPanel server={server} overview={overview} loading={loading} error={error} onRefresh={() => void loadOverview(server.id)} />
    </div>
  );
}
