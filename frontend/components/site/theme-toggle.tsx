"use client";

import { MoonStar, SunMedium } from "lucide-react";
import { useEffect, useState } from "react";

type ThemeMode = "light" | "dark";
type ThemeToggleProps = {
  compact?: boolean;
};

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

export default function ThemeToggle({ compact = false }: ThemeToggleProps) {
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

  const nextModeLabel = mode === "dark" ? "light" : "dark";
  const Icon = mode === "dark" ? SunMedium : MoonStar;

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={`button-secondary inline-flex items-center justify-center gap-2 rounded-full text-sm font-medium ${compact ? "h-11 w-11 px-0 py-0" : "px-4 py-2"}`}
      aria-pressed={mode === "dark"}
      aria-label={`Switch to ${nextModeLabel} mode`}
      title={compact ? `Use ${nextModeLabel} mode` : undefined}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      {compact ? null : `Use ${nextModeLabel} mode`}
    </button>
  );
}
