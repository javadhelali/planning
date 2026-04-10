"use client";

import { useEffect, useState } from "react";

type ThemeMode = "light" | "dark";
const THEME_STORAGE_KEY = "planning_theme";

const isThemeMode = (value: string | null): value is ThemeMode =>
  value === "light" || value === "dark";

const applyTheme = (mode: ThemeMode) => {
  const root = document.documentElement;
  root.dataset.theme = mode;
  root.style.colorScheme = mode;
};

const resolveCurrentMode = (): ThemeMode => {
  if (typeof document !== "undefined" && isThemeMode(document.documentElement.dataset.theme ?? null)) {
    return document.documentElement.dataset.theme as ThemeMode;
  }

  if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }

  return "light";
};

export default function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>(resolveCurrentMode);

  useEffect(() => {
    applyTheme(mode);
  }, [mode]);

  const toggleTheme = () => {
    const next = mode === "dark" ? "light" : "dark";
    setMode(next);
    document.cookie = `${THEME_STORAGE_KEY}=${next}; path=/; max-age=31536000; samesite=lax`;
    applyTheme(next);
  };

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="rounded-full border px-4 py-2 text-sm font-medium transition"
      style={{ borderColor: "var(--card-border)", color: "var(--foreground)" }}
      aria-pressed={mode === "dark"}
    >
      {mode === "dark" ? "Light mode" : "Dark mode"}
    </button>
  );
}
