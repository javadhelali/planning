"use client";

import { Loader2, TerminalSquare } from "lucide-react";

import { softBorder, timeAgo, type PaneRef } from "@/app/utilities/tmux";

// A single terminal (tmux pane) shown as a card with its last few lines. Click
// to expand into the full interactive terminal. The preview text is filled in
// lazily by the parent, so `loading` covers the gap before it arrives.
export default function TerminalPreview({
  pane,
  preview,
  loading,
  onOpen,
}: {
  pane: PaneRef;
  preview: string | undefined;
  loading: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="surface-card group flex w-full flex-col gap-2 overflow-hidden rounded-2xl border p-0 text-left transition hover:border-[var(--accent)]"
      style={{ borderColor: softBorder }}
    >
      <div className="flex items-center gap-2 border-b px-3 py-2" style={{ borderColor: softBorder }}>
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: pane.session.attached ? "var(--success)" : "color-mix(in srgb, var(--foreground-muted) 45%, transparent)" }}
          aria-hidden="true"
        />
        <TerminalSquare className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--foreground-muted)" }} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold" title={pane.label}>{pane.label}</span>
        <span className="shrink-0 font-mono text-[10px]" style={{ color: "var(--foreground-muted)" }}>{pane.pane.command || "?"}</span>
      </div>

      <div className="min-h-[64px] px-3 pb-2">
        {loading && preview === undefined ? (
          <div className="flex items-center gap-2 py-3 text-xs" style={{ color: "var(--foreground-muted)" }}>
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Loading…
          </div>
        ) : preview ? (
          <pre
            className="max-h-24 overflow-hidden whitespace-pre-wrap break-words text-[11px] leading-[1.5]"
            style={{ fontFamily: "var(--font-mono)", color: "var(--foreground-muted)" }}
          >
            {preview}
          </pre>
        ) : (
          <p className="py-3 text-xs" style={{ color: "var(--foreground-muted)" }}>No recent output.</p>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 px-3 pb-2.5 text-[10px]" style={{ color: "var(--foreground-muted)" }}>
        <span className="truncate font-mono" title={pane.target}>{pane.target}</span>
        <span className="shrink-0">{timeAgo(pane.session.activity)}</span>
      </div>
    </button>
  );
}
