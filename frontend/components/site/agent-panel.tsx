"use client";

import {
  ArrowDown,
  ArrowUp,
  Bot,
  ChevronDown,
  CircleStop,
  CornerDownLeft,
  Eraser,
  History,
  Loader2,
  RotateCw,
  Send,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import AnsiText from "@/components/site/ansi-text";
import VoiceInput, { type VoiceInputHandle } from "@/components/site/voice-input";
import { panelHeaderBorder, softBorder, type AgentModel } from "@/app/utilities/tmux";

// How tall the agent prompt box may grow before it starts scrolling.
const PROMPT_MAX_PX = 260;

// Keys worth having one tap away while the agent is working.
const AGENT_KEYS: Array<{ key: string; label: string; icon?: typeof ArrowUp }> = [
  { key: "Enter", label: "Enter", icon: CornerDownLeft },
  { key: "Escape", label: "Esc" },
  { key: "Up", label: "Up", icon: ArrowUp },
  { key: "Down", label: "Down", icon: ArrowDown },
  { key: "C-c", label: "Ctrl-C", icon: CircleStop },
];

// Model picker. A native <select> renders an unreadable white-on-white popup in
// the dark theme and can't show per-model detail, so this is a themed popover.
function ModelMenu({
  models,
  value,
  onChange,
}: {
  models: AgentModel[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocPointerDown);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onDocPointerDown);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  const selected = models.find((option) => option.id === value) ?? models[0] ?? null;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition"
        style={{ borderColor: softBorder, color: "var(--foreground)" }}
        title="Model Claude runs with"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Sparkles className="h-3.5 w-3.5" style={{ color: "var(--accent)" }} aria-hidden="true" />
        {selected?.label ?? "Default"}
        <ChevronDown className="h-3.5 w-3.5" style={{ color: "var(--foreground-muted)" }} aria-hidden="true" />
      </button>

      {open ? (
        // Opens upward — the composer sits at the bottom of the panel.
        <div
          role="listbox"
          className="absolute bottom-full left-0 z-30 mb-2 w-72 overflow-hidden rounded-xl border shadow-xl"
          style={{ borderColor: softBorder, backgroundColor: "var(--background-elevated)" }}
        >
          {models.map((option) => {
            const active = option.id === value;
            return (
              <button
                key={option.id || "default"}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(option.id);
                  setOpen(false);
                }}
                className="flex w-full flex-col gap-0.5 border-b px-3 py-2 text-left transition last:border-b-0 hover:bg-[var(--accent-tint)]"
                style={{
                  borderColor: "color-mix(in srgb, var(--card-border) 45%, transparent)",
                  backgroundColor: active ? "var(--accent-tint)" : "transparent",
                }}
              >
                <span className="flex items-center gap-2">
                  <span className="text-xs font-semibold" style={{ color: active ? "var(--accent)" : "var(--foreground)" }}>
                    {option.label}
                  </span>
                  {option.hint ? (
                    <span className="ml-auto font-mono text-[10px]" style={{ color: "var(--foreground-muted)" }}>
                      {option.hint}
                    </span>
                  ) : null}
                </span>
                {option.description ? (
                  <span className="text-[11px] leading-4" style={{ color: "var(--foreground-muted)" }}>
                    {option.description}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

// AI agent console: mirrors the project's Claude Code pane and sends prompts to it.
export default function AgentPanel({
  title,
  subtitle,
  models,
  model,
  onModelChange,
  clear,
  onClearChange,
  prompt,
  onPromptChange,
  onSend,
  sending,
  target,
  snapshot,
  resolving,
  error,
  onRefresh,
  lines,
  onLoadMore,
  canLoadMore,
  voiceUrl,
  onVoiceError,
  choices,
  onKey,
}: {
  title: string;
  subtitle: string;
  models: AgentModel[];
  model: string;
  onModelChange: (value: string) => void;
  clear: boolean;
  onClearChange: (value: boolean) => void;
  prompt: string;
  onPromptChange: (value: string) => void;
  onSend: () => void;
  sending: boolean;
  target: string | null;
  snapshot: string;
  resolving: boolean;
  error: string | null;
  onRefresh: () => void;
  lines: number;
  onLoadMore: () => void;
  canLoadMore: boolean;
  voiceUrl: string;
  onVoiceError: (message: string) => void;
  choices: Array<{ key: string; label: string }>;
  onKey: (key: string) => void;
}) {
  const screenRef = useRef<HTMLDivElement | null>(null);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const heardRef = useRef<HTMLDivElement | null>(null);
  const sendRef = useRef(onSend);
  const voiceRef = useRef<VoiceInputHandle | null>(null);
  // Ctrl+Enter mid-recording: finish the transcript first, then send it.
  const sendWhenDoneRef = useRef(false);
  // Whatever was already typed when the mic opened; dictation appends to it.
  const dictationBaseRef = useRef("");
  // What the mic is hearing right now, in the language it was spoken.
  const [heard, setHeard] = useState("");
  const [heardLanguage, setHeardLanguage] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);

  // Follow Claude's output as it streams in.
  useEffect(() => {
    const el = screenRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [snapshot]);

  // Grow the prompt box with its content instead of trapping it at two lines,
  // and only show a scrollbar once it actually hits the ceiling — otherwise the
  // browser leaves a phantom bar sitting there.
  useEffect(() => {
    const el = promptRef.current;
    if (!el) return;
    el.style.height = "auto";
    const needed = el.scrollHeight;
    el.style.height = `${Math.min(needed, PROMPT_MAX_PX)}px`;
    el.style.overflowY = needed > PROMPT_MAX_PX ? "auto" : "hidden";
  }, [prompt]);

  // Keep the *end* of the speech in view — that's the part you just said. The
  // caption wraps and scrolls, so long Persian is trimmed from the top, not the
  // tail (and it works for RTL, which horizontal truncation does not).
  useEffect(() => {
    const el = heardRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [heard]);

  useEffect(() => {
    sendRef.current = onSend;
  }, [onSend]);

  // Ctrl/Cmd + Enter sends, wherever focus happens to be. Mid-recording it also
  // closes the mic — and waits for the final tokens, so the tail of the sentence
  // makes it into the prompt instead of being cut off.
  const submit = useCallback(() => {
    if (voiceRef.current?.isRecording()) {
      sendWhenDoneRef.current = true;
      voiceRef.current.stop();
      return;
    }
    sendRef.current();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        submit();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [submit]);

  return (
    <section className="surface-card flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[24px]">
      <div className="flex items-center gap-2 border-b px-4 py-2.5" style={panelHeaderBorder}>
        <Bot className="h-4 w-4 shrink-0" style={{ color: "var(--accent)" }} aria-hidden="true" />
        <span className="shrink-0 text-sm font-semibold">{title}</span>
        <span className="min-w-0 truncate font-mono text-xs" style={{ color: "var(--foreground-muted)" }}>{subtitle}</span>

        <span
          className="ml-auto shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px]"
          style={
            target
              ? { backgroundColor: "var(--accent-tint)", color: "var(--accent)" }
              : { backgroundColor: "color-mix(in srgb, var(--background-elevated) 90%, transparent)", color: "var(--foreground-muted)" }
          }
          title={target ? `Claude is running in ${target}` : "No Claude session yet — sending will start one"}
        >
          {resolving ? "checking…" : target ?? "no session"}
        </span>
        {target ? (
          <button
            type="button"
            onClick={onLoadMore}
            disabled={!canLoadMore}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-2.5 text-xs font-medium disabled:opacity-40"
            style={{ borderColor: softBorder, color: "var(--foreground-muted)" }}
            title="Show more of Claude's history"
          >
            <History className="h-3.5 w-3.5" aria-hidden="true" />
            {lines}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border"
          style={{ borderColor: softBorder, color: "var(--foreground-muted)" }}
          title="Look for the Claude session again"
        >
          <RotateCw className={`h-3.5 w-3.5 ${resolving ? "animate-spin" : ""}`} aria-hidden="true" />
        </button>
      </div>

      {/* Claude's screen */}
      <div ref={screenRef} className="min-h-0 flex-1 overflow-auto" style={{ backgroundColor: "#0c0f14" }}>
        {target ? (
          <pre className="min-w-[520px] px-4 py-4 text-[12.5px] leading-[1.5]" style={{ fontFamily: "var(--font-mono)", color: "#d6dde6", whiteSpace: "pre" }}>
            <AnsiText text={snapshot} />
          </pre>
        ) : resolving ? (
          <div className="flex h-full flex-col items-center justify-center px-6 py-16 text-center">
            <Loader2 className="h-8 w-8 animate-spin" style={{ color: "#4a5568" }} aria-hidden="true" />
            <p className="mt-3 text-sm" style={{ color: "#8b98a9" }}>Looking for Claude in this project…</p>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-6 py-16 text-center">
            <Bot className="h-9 w-9" style={{ color: "#4a5568" }} aria-hidden="true" />
            <p className="mt-3 text-sm" style={{ color: "#8b98a9" }}>
              No Claude session in this project yet.
            </p>
            <p className="mt-1 text-xs" style={{ color: "#6b7787" }}>
              Send a prompt and one will be started for you.
            </p>
          </div>
        )}
      </div>

      {error ? (
        <div className="border-t px-4 py-2 text-xs" style={{ ...panelHeaderBorder, color: "var(--danger)" }}>{error}</div>
      ) : null}

      {/* Keys for driving the agent's pane directly. When Claude prints a
          numbered menu, its options show up here as taps. */}
      {target ? (
        <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto border-t px-4 pt-3" style={panelHeaderBorder}>
          {choices.length > 0 ? (
            <>
              <span className="mr-0.5 shrink-0 text-[11px] font-semibold" style={{ color: "var(--accent)" }}>
                Claude is asking:
              </span>
              {choices.map((choice) => (
                <button
                  key={choice.key}
                  type="button"
                  onClick={() => onKey(choice.key)}
                  className="inline-flex h-8 max-w-[220px] shrink-0 items-center gap-1.5 rounded-lg border px-2 text-xs font-medium"
                  style={{ borderColor: "color-mix(in srgb, var(--accent) 45%, transparent)", color: "var(--accent)" }}
                  title={`Answer ${choice.key}: ${choice.label}`}
                >
                  <span className="font-mono font-bold">{choice.key}</span>
                  <span className="truncate">{choice.label}</span>
                </button>
              ))}
              <span className="mx-1 h-5 w-px shrink-0" style={{ backgroundColor: softBorder }} aria-hidden="true" />
            </>
          ) : null}

          {AGENT_KEYS.map((quick) => {
            const Icon = quick.icon;
            return (
              <button
                key={quick.key}
                type="button"
                onClick={() => onKey(quick.key)}
                className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border px-2 text-xs font-medium"
                style={{ borderColor: softBorder, color: "var(--foreground-muted)" }}
                title={`Send ${quick.label} to the agent`}
              >
                {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                {quick.label}
              </button>
            );
          })}
        </div>
      ) : null}

      {/* Composer — one card holding the caption, the prompt and its toolbar, so
          nothing can drift out of alignment as the prompt grows. */}
      <div className="px-4 pb-4 pt-3">
        <div
          className="composer rounded-2xl border"
          style={{
            borderColor: softBorder,
            backgroundColor: "color-mix(in srgb, var(--background-elevated) 60%, transparent)",
          }}
        >
          {/* What the mic is picking up. The prompt below only ever receives
              English, so this is where you watch your Persian arrive. It scrolls
              to the newest words — the tail, never the head — with no scrollbar. */}
          {recording || heard ? (
            <div
              className="flex items-start gap-2 border-b px-3 py-2"
              style={{ borderColor: "color-mix(in srgb, var(--card-border) 45%, transparent)" }}
            >
              <span
                className="mt-px inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                style={
                  recording
                    ? { backgroundColor: "var(--danger)", color: "var(--background)" }
                    : { backgroundColor: "color-mix(in srgb, var(--foreground-muted) 15%, transparent)", color: "var(--foreground-muted)" }
                }
              >
                {recording ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" aria-hidden="true" /> : null}
                {recording ? "Listening" : "Heard"}
              </span>
              {heardLanguage ? (
                <span
                  className="mt-px shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase"
                  style={{ backgroundColor: "var(--accent-tint)", color: "var(--accent)" }}
                  title={heardLanguage === "en" ? "Heard English — no translation needed" : `Translating ${heardLanguage} → English`}
                >
                  {heardLanguage === "en" ? "EN" : `${heardLanguage} → EN`}
                </span>
              ) : null}
              <div
                ref={heardRef}
                dir="auto"
                className="no-scrollbar max-h-[3.4em] min-w-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-[1.7]"
                style={{ color: "var(--foreground-muted)" }}
              >
                {heard || "Say something…"}
              </div>
            </div>
          ) : null}

          <textarea
            ref={promptRef}
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
                event.preventDefault();
                submit();
              }
            }}
            rows={2}
            placeholder="Ask Claude to do something in this project…  (Ctrl+M to talk · Ctrl+↵ to send)"
            className="block w-full resize-none border-0 bg-transparent px-4 pt-3 text-sm leading-6 placeholder:opacity-60"
            style={{ color: "var(--foreground)", maxHeight: `${PROMPT_MAX_PX}px` }}
          />

          {/* Toolbar. Settings live on the left, message actions on the right.
              The mic is in the right group so that when recording widens it, it
              grows into the empty middle — Send stays put and the left controls
              never budge. Every control is h-9, so nothing can misalign. */}
          <div className="flex flex-wrap items-center gap-2 px-3 pb-3 pt-2">
            <ModelMenu models={models} value={model} onChange={onModelChange} />

            <button
              type="button"
              onClick={() => onClearChange(!clear)}
              disabled={!target}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition disabled:opacity-40"
              style={
                clear
                  ? { borderColor: "var(--accent)", backgroundColor: "var(--accent-tint)", color: "var(--accent)" }
                  : { borderColor: softBorder, color: "var(--foreground-muted)" }
              }
              title={
                target
                  ? "Run /clear first, so Claude starts from a fresh context"
                  : "A new session already starts with a clean context"
              }
            >
              <Eraser className="h-3.5 w-3.5" aria-hidden="true" />
              Clear context
            </button>

            <div className="ml-auto flex shrink-0 items-center gap-2">
              <VoiceInput
                ref={voiceRef}
                socketUrl={voiceUrl}
                disabled={sending}
                targetLanguage="en"
                shortcutKey="m"
                title="Speak your prompt (Persian or English)"
                onRecordingChange={(value) => {
                  setRecording(value);
                  // A Ctrl+Enter arrived mid-recording: the transcript has now
                  // finished arriving, so send it.
                  if (!value && sendWhenDoneRef.current) {
                    sendWhenDoneRef.current = false;
                    sendRef.current();
                  }
                }}
                onStart={() => {
                  const typed = prompt.trim();
                  dictationBaseRef.current = typed ? `${typed} ` : "";
                  setHeard("");
                  setHeardLanguage(null);
                }}
                onTranscript={({ text, original, language }) => {
                  setHeard(original);
                  setHeardLanguage(language);
                  onPromptChange(dictationBaseRef.current + text);
                }}
                onError={onVoiceError}
              />

              <button
                type="button"
                onClick={submit}
                disabled={!prompt.trim() || sending}
                className="button-primary inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3.5 text-xs font-semibold disabled:opacity-40"
                title="Send (Ctrl+↵)"
              >
                {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Send className="h-3.5 w-3.5" aria-hidden="true" />}
                {sending ? "Sending" : "Send"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
