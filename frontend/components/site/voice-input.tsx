"use client";

import { Loader2, Mic, Square } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

// Soniox tags every token, so one stream carries the original speech and its
// translation side by side.
type VoiceToken = {
  text: string;
  is_final: boolean;
  translation_status?: string;
  language?: string;
  source_language?: string;
};

type VoiceMessage = {
  tokens?: VoiceToken[];
  finished?: boolean;
  error_code?: number | null;
  error_message?: string | null;
};

// A token kept in structured form so the transcript can be *recomputed* as we
// learn more (see pickText) rather than being baked into a string too early.
type Entry = {
  text: string;
  translated: boolean;
  language: string | null;
};

export type VoiceResult = {
  /** What belongs in the text box: target-language text, whichever way it got there. */
  text: string;
  /** The raw speech as heard, in whatever languages were spoken. */
  original: string;
  /** Language of the most recent speech, e.g. "fa" or "en". */
  language: string | null;
};

export type VoiceInputHandle = {
  /** Stop recording and let the tail of the transcript arrive. */
  stop: () => void;
  isRecording: () => boolean;
};

type Status = "idle" | "connecting" | "recording" | "finishing";

// Send audio often enough that the transcript feels live.
const CHUNK_MS = 120;

// The server accepts whatever container the browser produces (`audio_format:
// auto`), so take the first the browser can actually record.
const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

function closeReason(code: number): string {
  if (code === 4401) return "Your session expired — sign in again.";
  if (code === 4402) return "Speech-to-text isn’t configured on the server.";
  if (code === 4500) return "Could not reach the speech service.";
  return "Voice input stopped unexpectedly.";
}

function formatElapsed(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

/**
 * Choose the text destined for the box, handling speech that switches language
 * mid-sentence.
 *
 * Every spoken token arrives as an `original`; anything not already in the
 * target language is *also* sent again as a `translation`. So the target-language
 * rendering is: every translation, plus the originals that were already in the
 * target language. Originals in other languages are dropped — their translation
 * carries them.
 *
 * `translatesTarget` covers the case where Soniox also translates target→target
 * (their docs don't say whether it does). If we ever see a translation whose
 * source *is* the target, we stop taking target-language originals so the text
 * isn't duplicated. Because entries stay structured, flipping that flag simply
 * changes the next recomputation — nothing has been committed to a string.
 */
function pickText(entries: Entry[], target: string, translatesTarget: boolean): string {
  return entries
    .filter((entry) => {
      if (entry.translated) return true;
      if (translatesTarget) return false;
      return entry.language === target;
    })
    .map((entry) => entry.text)
    .join("");
}

/**
 * Push-to-talk control. Streams microphone audio to `socketUrl` and reports the
 * running transcript — speak Persian and you get English text as you talk.
 */
const VoiceInput = forwardRef<VoiceInputHandle, {
  socketUrl: string;
  onTranscript: (result: VoiceResult) => void;
  onStart?: () => void;
  onError?: (message: string) => void;
  onRecordingChange?: (recording: boolean) => void;
  targetLanguage?: string;
  disabled?: boolean;
  /** Toggle recording with Ctrl + this key, from anywhere on the page. Ctrl (not
   *  Cmd) because ⌘M minimizes the window on macOS and can't be intercepted. */
  shortcutKey?: string;
  title?: string;
}>(function VoiceInput(
  {
    socketUrl,
    onTranscript,
    onStart,
    onError,
    onRecordingChange,
    targetLanguage = "en",
    disabled = false,
    shortcutKey,
    title = "Speak your prompt",
  },
  ref,
) {
  const target = targetLanguage.toLowerCase();

  // Callers naturally pass inline arrows, whose identity changes every render.
  // Route every callback through a ref so the teardown/meter callbacks below can
  // have empty dependency arrays — otherwise the "clean up on unmount" effect
  // sees a changed dependency mid-recording and tears the recording down.
  const handlersRef = useRef({ onTranscript, onStart, onError, onRecordingChange });
  useEffect(() => {
    handlersRef.current = { onTranscript, onStart, onError, onRecordingChange };
  });

  const [status, setStatus] = useState<Status>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [metered, setMetered] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Finalized tokens never change again; provisional ones are resent each frame.
  const finalRef = useRef<Entry[]>([]);
  const languageRef = useRef<string | null>(null);
  const translatesTargetRef = useRef(false);

  // Live level meter, driven straight from the mic so the bars track your voice.
  const audioContextRef = useRef<AudioContext | null>(null);
  const frameRef = useRef<number | null>(null);
  const barsRef = useRef<Array<HTMLSpanElement | null>>([]);

  const stopMeter = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    void audioContextRef.current?.close().catch(() => {});
    audioContextRef.current = null;
    setMetered(false);
  }, []);

  const startMeter = useCallback((stream: MediaStream) => {
    try {
      const context = new AudioContext();
      audioContextRef.current = context;
      const analyser = context.createAnalyser();
      // Small FFT + heavy smoothing: we want a responsive level, not a spectrogram.
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.75;
      context.createMediaStreamSource(stream).connect(analyser);

      const spectrum = new Uint8Array(analyser.frequencyBinCount);
      // Speech energy sits low in the spectrum; the top bins are mostly silence.
      const usable = Math.floor(spectrum.length * 0.6);

      const tick = () => {
        analyser.getByteFrequencyData(spectrum);
        const bars = barsRef.current;
        const bucket = Math.max(1, Math.floor(usable / bars.length));
        bars.forEach((bar, index) => {
          if (!bar) return;
          let sum = 0;
          for (let i = 0; i < bucket; i += 1) sum += spectrum[index * bucket + i] ?? 0;
          const level = sum / bucket / 255;
          // Floor keeps the bars visible in silence; the gain makes speech fill them.
          const scale = Math.min(1, Math.max(0.18, level * 2.4));
          bar.style.transform = `scaleY(${scale})`;
        });
        frameRef.current = requestAnimationFrame(tick);
      };

      frameRef.current = requestAnimationFrame(tick);
      setMetered(true);
    } catch {
      // No Web Audio (or it's blocked) — the CSS fallback animation covers us.
      setMetered(false);
    }
  }, []);

  const releaseMic = useCallback(() => {
    stopMeter();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, [stopMeter]);

  const teardown = useCallback(() => {
    releaseMic();
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket && socket.readyState <= WebSocket.OPEN) socket.close();
    setStatus("idle");
    setElapsed(0);
    handlersRef.current.onRecordingChange?.(false);
  }, [releaseMic]);

  // Stable, so this only ever fires on unmount.
  useEffect(() => teardown, [teardown]);

  // Recording timer.
  useEffect(() => {
    if (status !== "recording") return;
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 500);
    return () => window.clearInterval(timer);
  }, [status]);

  function handleMessage(raw: string) {
    let data: VoiceMessage;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }

    if (data.error_code) {
      handlersRef.current.onError?.(data.error_message || "Speech service error.");
      teardown();
      return;
    }

    const pending: Entry[] = [];

    for (const token of data.tokens ?? []) {
      const translated = token.translation_status === "translation";

      if (translated) {
        // Does the service translate target→target? If so, target-language
        // originals are redundant and must not be taken as well.
        if ((token.source_language ?? "").toLowerCase() === target) translatesTargetRef.current = true;
      } else if (token.language) {
        languageRef.current = token.language.toLowerCase();
      }

      const entry: Entry = {
        text: token.text,
        translated,
        // Carry the last known language forward — the first tokens of an
        // utterance can land before identification catches up.
        language: translated ? target : (token.language?.toLowerCase() ?? languageRef.current),
      };

      if (token.is_final) finalRef.current.push(entry);
      else pending.push(entry);
    }

    const entries = [...finalRef.current, ...pending];
    const text = pickText(entries, target, translatesTargetRef.current).trim();
    const original = entries
      .filter((entry) => !entry.translated)
      .map((entry) => entry.text)
      .join("")
      .trim();

    handlersRef.current.onTranscript({ text, original, language: languageRef.current });

    if (data.finished) teardown();
  }

  async function start() {
    if (disabled || status !== "idle") return;
    if (!socketUrl) {
      handlersRef.current.onError?.("Voice input isn’t ready yet — try again in a moment.");
      return;
    }
    // The mic is only exposed in a secure context: HTTPS, or localhost. Over
    // plain http:// on an IP or domain, navigator.mediaDevices is undefined —
    // which is the usual cause here, so name it rather than blaming the browser.
    if (typeof window !== "undefined" && !window.isSecureContext) {
      handlersRef.current.onError?.("Microphone needs HTTPS or localhost — this page is served over plain http.");
      return;
    }
    if (!navigator?.mediaDevices?.getUserMedia) {
      handlersRef.current.onError?.("This browser can’t record audio.");
      return;
    }

    finalRef.current = [];
    languageRef.current = null;
    translatesTargetRef.current = false;
    setStatus("connecting");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      setStatus("idle");
      handlersRef.current.onError?.("Microphone permission was denied.");
      return;
    }
    streamRef.current = stream;

    const socket = new WebSocket(socketUrl);
    socketRef.current = socket;

    socket.onopen = () => {
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0 && socket.readyState === WebSocket.OPEN) socket.send(event.data);
      };
      recorder.start(CHUNK_MS);
      recorderRef.current = recorder;
      setStatus("recording");
      startMeter(stream);
      handlersRef.current.onStart?.();
      handlersRef.current.onRecordingChange?.(true);
    };

    socket.onmessage = (event) => handleMessage(String(event.data));

    socket.onclose = (event) => {
      // 1000/1005 are the normal "we're done" paths.
      if (event.code > 1001 && event.code !== 1005) handlersRef.current.onError?.(closeReason(event.code));
      teardown();
    };
  }

  function stop() {
    if (status !== "recording") return;
    setStatus("finishing");
    // Stop the mic first, then tell the server no more audio is coming — it
    // drains the last tokens before closing, so the tail isn't lost.
    releaseMic();
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send("");
    else teardown();
  }

  const recording = status === "recording";
  const busy = status === "connecting" || status === "finishing";

  useImperativeHandle(ref, () => ({ stop, isRecording: () => recording }));

  // Ctrl + shortcutKey toggles recording from anywhere on the page.
  useEffect(() => {
    if (!shortcutKey) return;
    function onKeyDown(event: KeyboardEvent) {
      if (!event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key.toLowerCase() !== shortcutKey!.toLowerCase()) return;
      event.preventDefault();
      if (recording) stop();
      else if (!busy && !disabled) void start();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  if (recording) {
    return (
      <button
        type="button"
        onClick={stop}
        className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-2.5 transition"
        style={{ backgroundColor: "var(--danger)", color: "var(--background)" }}
        title={shortcutKey ? `Stop recording (Ctrl+${shortcutKey.toUpperCase()})` : "Stop and finish transcribing"}
        aria-label="Stop recording"
      >
        {/* Level meter driven by the mic — the bars move with your voice. */}
        <span className="flex h-4 items-end gap-[3px]" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((index) => (
            <span
              key={index}
              ref={(element) => {
                barsRef.current[index] = element;
              }}
              className={`voice-bar w-[3px] rounded-full ${metered ? "" : "voice-bar-idle"}`}
              style={{
                height: "100%",
                backgroundColor: "currentColor",
                transform: "scaleY(0.18)",
                animationDelay: `${index * 120}ms`,
              }}
            />
          ))}
        </span>
        <span className="font-mono text-xs font-semibold tabular-nums">{formatElapsed(elapsed)}</span>
        <Square className="h-3 w-3 fill-current" aria-hidden="true" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void start()}
      disabled={disabled || busy}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition hover:text-[var(--accent)] disabled:opacity-50"
      style={{ borderColor: "color-mix(in srgb, var(--card-border) 70%, transparent)", color: "var(--foreground-muted)" }}
      title={shortcutKey ? `${title} (Ctrl+${shortcutKey.toUpperCase()})` : title}
      aria-label={title}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Mic className="h-4 w-4" aria-hidden="true" />}
    </button>
  );
});

export default VoiceInput;
