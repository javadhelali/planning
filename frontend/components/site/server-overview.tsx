"use client";

import { Clock, Cog, HardDrive, Loader2, RotateCw, Server as ServerIcon } from "lucide-react";

import { panelHeaderBorder, softBorder, type Server, type ServerOverview } from "@/app/utilities/tmux";

// Server overview panel: disk usage, running services, and the user's cronjobs.
export default function ServerOverviewPanel({
  server,
  overview,
  loading,
  error,
  onRefresh,
}: {
  server: Server | null;
  overview: ServerOverview | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  return (
    <section className="surface-card flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[24px]">
      <div className="flex items-center gap-2 border-b px-4 py-2.5" style={panelHeaderBorder}>
        <ServerIcon className="h-4 w-4 shrink-0" style={{ color: "var(--foreground-muted)" }} aria-hidden="true" />
        <span className="shrink-0 text-sm font-semibold">{server?.name ?? "Server"}</span>
        {server ? <span className="min-w-0 truncate text-xs" style={{ color: "var(--foreground-muted)" }}>{server.host}</span> : null}
        <button
          type="button"
          onClick={onRefresh}
          className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-full border"
          style={{ borderColor: softBorder, color: "var(--foreground-muted)" }}
          title="Refresh overview"
        >
          <RotateCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {loading && !overview ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-7 w-7 animate-spin" style={{ color: "var(--foreground-muted)" }} aria-hidden="true" />
          </div>
        ) : error ? (
          <p className="text-sm" style={{ color: "var(--danger)" }}>{error}</p>
        ) : overview ? (
          <div className="space-y-6">
            {/* Disk usage */}
            <div>
              <h3 className="mb-2 inline-flex items-center gap-2 text-sm font-semibold">
                <HardDrive className="h-4 w-4" style={{ color: "var(--accent)" }} aria-hidden="true" /> Disk usage
              </h3>
              {overview.disk.length === 0 ? (
                <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>No disk information.</p>
              ) : (
                <div className="space-y-2">
                  {overview.disk.map((disk) => {
                    const pct = parseInt(disk.use_percent, 10) || 0;
                    return (
                      <div key={`${disk.mounted_on}-${disk.filesystem}`} className="rounded-xl border px-3 py-2" style={{ borderColor: softBorder }}>
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="truncate font-mono font-semibold">{disk.mounted_on}</span>
                          <span className="shrink-0" style={{ color: "var(--foreground-muted)" }}>{disk.used} / {disk.size} · {disk.avail} free</span>
                        </div>
                        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full" style={{ backgroundColor: "color-mix(in srgb, var(--foreground-muted) 20%, transparent)" }}>
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: pct >= 90 ? "var(--danger)" : "var(--accent)" }} />
                        </div>
                        <div className="mt-1 flex items-center justify-between text-[10px]" style={{ color: "var(--foreground-muted)" }}>
                          <span className="min-w-0 truncate font-mono">{disk.filesystem}</span>
                          <span className="shrink-0">{disk.use_percent}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Running services */}
            <div>
              <h3 className="mb-2 inline-flex items-center gap-2 text-sm font-semibold">
                <Cog className="h-4 w-4" style={{ color: "var(--accent)" }} aria-hidden="true" /> Running services
                <span className="text-xs font-normal" style={{ color: "var(--foreground-muted)" }}>({overview.services.length})</span>
              </h3>
              {overview.services.length === 0 ? (
                <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>No running services found.</p>
              ) : (
                <ul className="divide-y overflow-hidden rounded-xl border" style={{ borderColor: softBorder }}>
                  {overview.services.map((service) => (
                    <li key={`${service.scope}-${service.name}`} className="flex items-center gap-2 px-3 py-2">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: "var(--success)" }} aria-hidden="true" />
                      <span className="shrink-0 font-mono text-xs font-semibold">{service.name}</span>
                      {service.scope === "user" ? (
                        <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide" style={{ backgroundColor: "var(--accent-tint)", color: "var(--accent)" }}>user</span>
                      ) : null}
                      <span className="min-w-0 flex-1 truncate text-xs" style={{ color: "var(--foreground-muted)" }} title={service.description}>{service.description}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Cronjobs */}
            <div>
              <h3 className="mb-2 inline-flex items-center gap-2 text-sm font-semibold">
                <Clock className="h-4 w-4" style={{ color: "var(--accent)" }} aria-hidden="true" /> Cronjobs
              </h3>
              {overview.cronjobs.length === 0 ? (
                <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>No cronjobs for this user.</p>
              ) : (
                <ul className="space-y-1 rounded-xl border p-2" style={{ borderColor: softBorder }}>
                  {overview.cronjobs.map((job, index) => (
                    <li
                      key={`${index}-${job}`}
                      className="truncate rounded px-2 py-1 font-mono text-xs"
                      style={{ backgroundColor: "color-mix(in srgb, var(--background-elevated) 90%, transparent)" }}
                      title={job}
                    >
                      {job}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
