import { CSSProperties, Fragment, ReactNode } from "react";

/**
 * Renders terminal output containing ANSI SGR escape sequences as colored
 * spans. Deliberately small and dependency-free — it covers the sequences
 * `tmux capture-pane -e` actually emits (16 colors, 256-color, truecolor,
 * bold/dim/italic/underline/inverse) and passes everything else through as
 * plain text. Unsupported escape sequences are stripped so they never leak
 * into the visible output.
 */

// One Dark-ish palette; tuned to read well on the #0c0f14 terminal background.
const BASE_COLORS = [
  "#2e3436", // 0 black
  "#e06c75", // 1 red
  "#98c379", // 2 green
  "#e5c07b", // 3 yellow
  "#61afef", // 4 blue
  "#c678dd", // 5 magenta
  "#56b6c2", // 6 cyan
  "#d6dde6", // 7 white
];
const BRIGHT_COLORS = [
  "#5c6370", // 8 bright black
  "#ff7b72", // 9 bright red
  "#b5e08a", // 10 bright green
  "#f0d399", // 11 bright yellow
  "#79c0ff", // 12 bright blue
  "#d2a8ff", // 13 bright magenta
  "#7fd6df", // 14 bright cyan
  "#ffffff", // 15 bright white
];

const DEFAULT_FG = "#d6dde6";

// Resolve an xterm 256-color index to a hex string.
function color256(n: number): string {
  if (n < 8) return BASE_COLORS[n];
  if (n < 16) return BRIGHT_COLORS[n - 8];
  if (n < 232) {
    const i = n - 16;
    const steps = [0, 95, 135, 175, 215, 255];
    const r = steps[Math.floor(i / 36) % 6];
    const g = steps[Math.floor(i / 6) % 6];
    const b = steps[i % 6];
    return `rgb(${r}, ${g}, ${b})`;
  }
  const v = 8 + (n - 232) * 10; // grayscale ramp
  return `rgb(${v}, ${v}, ${v})`;
}

type State = {
  fg: string | null;
  bg: string | null;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
};

const INITIAL: State = {
  fg: null,
  bg: null,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  inverse: false,
};

// Apply one SGR sequence (the numeric codes between ESC[ and `m`) to `state`.
function applyCodes(state: State, codes: number[]): State {
  const next = { ...state };
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    if (code === 0) Object.assign(next, INITIAL);
    else if (code === 1) next.bold = true;
    else if (code === 2) next.dim = true;
    else if (code === 3) next.italic = true;
    else if (code === 4) next.underline = true;
    else if (code === 7) next.inverse = true;
    else if (code === 22) { next.bold = false; next.dim = false; }
    else if (code === 23) next.italic = false;
    else if (code === 24) next.underline = false;
    else if (code === 27) next.inverse = false;
    else if (code >= 30 && code <= 37) next.fg = BASE_COLORS[code - 30];
    else if (code >= 90 && code <= 97) next.fg = BRIGHT_COLORS[code - 90];
    else if (code === 39) next.fg = null;
    else if (code >= 40 && code <= 47) next.bg = BASE_COLORS[code - 40];
    else if (code >= 100 && code <= 107) next.bg = BRIGHT_COLORS[code - 100];
    else if (code === 49) next.bg = null;
    else if (code === 38 || code === 48) {
      // Extended color: 38/48 ; 5 ; n  (256)  or  38/48 ; 2 ; r ; g ; b (truecolor)
      const target = code === 38 ? "fg" : "bg";
      const mode = codes[i + 1];
      if (mode === 5) {
        next[target] = color256(codes[i + 2] ?? 0);
        i += 2;
      } else if (mode === 2) {
        const r = codes[i + 2] ?? 0;
        const g = codes[i + 3] ?? 0;
        const b = codes[i + 4] ?? 0;
        next[target] = `rgb(${r}, ${g}, ${b})`;
        i += 4;
      }
    }
  }
  return next;
}

function styleFor(state: State): CSSProperties {
  const style: CSSProperties = {};
  let fg = state.fg ?? DEFAULT_FG;
  let bg = state.bg;
  if (state.inverse) {
    const realFg = state.fg ?? DEFAULT_FG;
    fg = state.bg ?? "#0c0f14";
    bg = realFg;
  }
  if (fg !== DEFAULT_FG) style.color = fg;
  if (bg) style.backgroundColor = bg;
  if (state.bold) style.fontWeight = 600;
  if (state.dim) style.opacity = 0.65;
  if (state.italic) style.fontStyle = "italic";
  if (state.underline) style.textDecoration = "underline";
  return style;
}

// Match an ANSI escape sequence: SGR (`m`) sequences carry color, others are
// consumed and dropped so cursor/clear codes don't render as literal text.
const ANSI_RE = /\x1b\[([0-9;?]*)([a-zA-Z])/g;

export default function AnsiText({ text }: { text: string }) {
  if (!text) return <>{" "}</>;

  const parts: ReactNode[] = [];
  let state = INITIAL;
  let lastIndex = 0;
  let key = 0;

  const push = (chunk: string, s: State) => {
    if (!chunk) return;
    const style = styleFor(s);
    if (Object.keys(style).length === 0) parts.push(<Fragment key={key++}>{chunk}</Fragment>);
    else parts.push(<span key={key++} style={style}>{chunk}</span>);
  };

  ANSI_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ANSI_RE.exec(text)) !== null) {
    push(text.slice(lastIndex, match.index), state);
    lastIndex = ANSI_RE.lastIndex;
    if (match[2] === "m") {
      const codes = match[1] === "" ? [0] : match[1].split(";").map((n) => parseInt(n, 10) || 0);
      state = applyCodes(state, codes);
    }
    // Non-`m` sequences (cursor moves, clears, etc.) are simply dropped.
  }
  push(text.slice(lastIndex), state);

  return <>{parts}</>;
}
