"use client";

import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronsDownUp,
  CircleStop,
  CornerDownLeft,
  LogOut,
  RotateCw,
  Send,
  Sparkles,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import AnsiText from "@/components/site/ansi-text";
import { CAPTURE_LINE_STEPS, panelHeaderBorder, softBorder } from "@/app/utilities/tmux";

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

// The interactive terminal view for a single tmux pane. Presentational: the
// parent owns the capture polling and the send/exit actions; this renders the
// screen and forwards intent through callbacks.
export default function TerminalView({
  target,
  badge,
  snapshot,
  snapshotError,
  isLive,
  onToggleLive,
  historyLines,
  onSetLines,
  onRefresh,
  onSendKey,
  onSendText,
  onExit,
  onClose,
}: {
  target: string;
  badge?: string | null;
  snapshot: string;
  snapshotError: string | null;
  isLive: boolean;
  onToggleLive: () => void;
  historyLines: number;
  onSetLines: (lines: number) => void;
  onRefresh: () => void;
  onSendKey: (key: string) => void;
  onSendText: (text: string) => void;
  onExit: () => void;
  onClose?: () => void;
}) {
  const [message, setMessage] = useState("");
  const [exitArmed, setExitArmed] = useState(false);
  const exitArmTimer = useRef<number | null>(null);
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  function disarmExit() {
    if (exitArmTimer.current) {
      window.clearTimeout(exitArmTimer.current);
      exitArmTimer.current = null;
    }
    setExitArmed(false);
  }

  // First click arms the button; a second within a few seconds confirms and
  // asks the parent to close the pane (send Ctrl-D + refresh the tree).
  function handleExit() {
    if (!exitArmed) {
      setExitArmed(true);
      exitArmTimer.current = window.setTimeout(() => disarmExit(), 3000);
      return;
    }
    disarmExit();
    onExit();
  }

  function autosizeComposer() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }

  useEffect(() => {
    autosizeComposer();
  }, [message]);

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

  function onTerminalScroll() {
    const el = terminalRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  }

  function sendMessage() {
    if (!message.trim()) return;
    onSendText(message);
    setMessage("");
  }

  // The next scrollback step up from the current one (wraps back to the first).
  const nextLines = CAPTURE_LINE_STEPS.find((step) => step > historyLines) ?? CAPTURE_LINE_STEPS[0];
  const canLoadMore = nextLines > historyLines;

  return (
    <section className="surface-card flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[24px]">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2.5" style={panelHeaderBorder}>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 items-center gap-1 rounded-lg border px-2 text-xs font-medium"
            style={{ borderColor: softBorder, color: "var(--foreground-muted)" }}
            title="Back to terminals"
          >
            <ChevronsDownUp className="h-3.5 w-3.5" aria-hidden="true" />
            Back
          </button>
        ) : null}
        <span className="truncate font-mono text-xs font-semibold" title={target}>{target}</span>
        {badge ? (
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
            style={{ backgroundColor: "var(--accent-tint)", color: "var(--accent)" }}
          >
            {badge}
          </span>
        ) : null}

        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onSetLines(nextLines)}
            disabled={!canLoadMore}
            className="inline-flex h-8 items-center gap-1 rounded-full border px-2.5 text-xs font-medium disabled:opacity-40"
            style={{ borderColor: softBorder, color: "var(--foreground-muted)" }}
            title="Capture more scrollback"
          >
            <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
            {historyLines} lines
          </button>
          <button
            type="button"
            onClick={onToggleLive}
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
            onClick={onRefresh}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border"
            style={{ borderColor: softBorder, color: "var(--foreground-muted)" }}
            title="Refresh snapshot"
          >
            <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Screen */}
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
      <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto border-t px-4 pt-3" style={panelHeaderBorder}>
        {QUICK_KEYS.map((quick) => {
          const Icon = quick.icon;
          return (
            <button
              key={quick.key}
              type="button"
              onClick={() => onSendKey(quick.key)}
              className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border px-2 text-xs font-medium"
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
            onClick={() => onSendText(command)}
            className="inline-flex h-8 shrink-0 items-center rounded-lg border px-2 font-mono text-xs font-medium"
            style={{ borderColor: "color-mix(in srgb, var(--accent) 40%, transparent)", color: "var(--accent)" }}
            title={`Run ${command} in Claude Code`}
          >
            {command}
          </button>
        ))}

        <button
          type="button"
          onClick={handleExit}
          onBlur={() => exitArmed && disarmExit()}
          className="ml-auto inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border px-2 text-xs font-medium transition"
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
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              sendMessage();
            }
          }}
          rows={1}
          placeholder="Type a command…  (Enter to send · Shift+Enter for a new line)"
          className="field max-h-[168px] min-h-[44px] flex-1 resize-none overflow-y-auto rounded-2xl px-4 py-2.5 font-mono text-sm leading-6"
        />
        <button
          type="button"
          onClick={sendMessage}
          disabled={!message.trim()}
          className="button-primary inline-flex h-[44px] shrink-0 items-center gap-2 rounded-2xl px-4 text-sm font-semibold disabled:opacity-50"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
          Send
        </button>
      </div>
    </section>
  );
}
