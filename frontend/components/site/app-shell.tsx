"use client";

import { toJalaali } from "jalaali-js";
import {
  BookOpenText,
  CalendarDays,
  LayoutGrid,
  ListTodo,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Target,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode, useCallback, useEffect, useState } from "react";

import { get } from "@/app/utilities/api";
import ThemeToggle from "@/components/site/theme-toggle";

type AppShellProps = {
  children: ReactNode;
};

type NavItem = {
  href: string;
  label: string;
  description: string;
  icon: "dashboard" | "tasks" | "okrs" | "glossary" | "admin";
};

type FocusedTask = {
  id: number;
  title: string;
  due_date: string | null;
  status: "todo" | "done";
  is_focused: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", description: "Overview", icon: "dashboard" },
  { href: "/tasks", label: "Tasks", description: "Task space", icon: "tasks" },
  { href: "/okrs", label: "OKRs", description: "Goal tracking", icon: "okrs" },
  { href: "/glossary", label: "Glossary", description: "Term mastery", icon: "glossary" },
  { href: "/admin", label: "Admin", description: "Workspace controls", icon: "admin" },
];

function NavIcon({ icon, active }: { icon: NavItem["icon"]; active: boolean }) {
  const className = "h-5 w-5";

  if (icon === "dashboard") {
    return <LayoutGrid aria-hidden="true" className={className} color={active ? "var(--accent)" : "var(--foreground-muted)"} />;
  }

  if (icon === "admin") {
    return <LayoutGrid aria-hidden="true" className={className} color={active ? "var(--accent)" : "var(--foreground-muted)"} />;
  }

  if (icon === "okrs") {
    return <Target aria-hidden="true" className={className} color={active ? "var(--accent)" : "var(--foreground-muted)"} />;
  }

  if (icon === "glossary") {
    return <BookOpenText aria-hidden="true" className={className} color={active ? "var(--accent)" : "var(--foreground-muted)"} />;
  }

  return <ListTodo aria-hidden="true" className={className} color={active ? "var(--accent)" : "var(--foreground-muted)"} />;
}

function isItemActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function formatDueDate(value: string | null) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));
  if (!year || !month || !day) return value;

  const jalali = toJalaali(year, month, day);
  return `${jalali.jy}/${String(jalali.jm).padStart(2, "0")}/${String(jalali.jd).padStart(2, "0")}`;
}

export default function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const currentSection = NAV_ITEMS.find((item) => isItemActive(pathname, item.href)) ?? NAV_ITEMS[0];
  const [focusedTask, setFocusedTask] = useState<FocusedTask | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("planning_sidebar_collapsed") === "true";
  });
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  const loadFocusedTask = useCallback(async () => {
    try {
      const response = await get("/planning/tasks/focused");
      if (!response.ok) {
        return;
      }

      const task = (await response.json()) as FocusedTask | null;
      if (task?.is_focused && task.status !== "done") {
        setFocusedTask(task);
      } else {
        setFocusedTask(null);
      }
    } catch {
      // Keep shell resilient; task page still remains the source of truth.
      setFocusedTask(null);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("planning_sidebar_collapsed", String(isCollapsed));
  }, [isCollapsed]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadFocusedTask();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadFocusedTask, pathname]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void loadFocusedTask();
    }, 60_000);

    function onVisibilityChange() {
      if (!document.hidden) {
        void loadFocusedTask();
      }
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [loadFocusedTask]);

  const showFocusedTaskBanner = pathname !== "/tasks" && focusedTask !== null;

  return (
    <div className="min-h-screen">
      {isMobileOpen ? (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-30 bg-black/30 lg:hidden"
          onClick={() => setIsMobileOpen(false)}
        />
      ) : null}

      <div className="flex min-h-screen w-full">
        <aside
          className={`fixed inset-y-0 left-0 z-40 flex flex-col border-r bg-[var(--background)] px-2 py-4 transition-transform duration-200 lg:static lg:translate-x-0 ${
            isMobileOpen ? "translate-x-0" : "-translate-x-full"
          } ${isCollapsed ? "w-[84px]" : "w-[248px]"}`}
          style={{ borderColor: "color-mix(in srgb, var(--card-border) 72%, transparent)" }}
        >
          <div className={`flex items-center ${isCollapsed ? "justify-center" : "justify-between"} px-2`}>
            <Link href="/" className={`flex items-center rounded-[20px] py-2 ${isCollapsed ? "justify-center" : "gap-3 px-1"}`}>
              <span
                className="flex h-11 w-11 items-center justify-center rounded-2xl text-base font-semibold"
                style={{ backgroundColor: "var(--accent-tint)", color: "var(--accent)" }}
              >
                P
              </span>
              {!isCollapsed ? (
                <span>
                  <span className="block text-lg font-semibold leading-none">Planning</span>
                  <span className="mt-1 block text-xs" style={{ color: "var(--foreground-muted)" }}>
                    Task workspace
                  </span>
                </span>
              ) : null}
            </Link>

            {!isCollapsed ? (
              <button
                type="button"
                aria-label="Collapse sidebar"
                onClick={() => setIsCollapsed(true)}
                className="hidden h-10 w-10 items-center justify-center rounded-full lg:inline-flex"
                style={{ color: "var(--foreground-muted)" }}
              >
                <PanelLeftClose className="h-5 w-5" aria-hidden="true" />
              </button>
            ) : null}
          </div>

          {isCollapsed ? (
            <button
              type="button"
              aria-label="Expand sidebar"
              onClick={() => setIsCollapsed(false)}
              className="mx-auto mt-4 hidden h-10 w-10 items-center justify-center rounded-full lg:inline-flex"
              style={{ color: "var(--foreground-muted)" }}
            >
              <PanelLeftOpen className="h-5 w-5" aria-hidden="true" />
            </button>
          ) : null}

          <nav className="mt-6 space-y-1">
            {NAV_ITEMS.map((item) => {
              const active = isItemActive(pathname, item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setIsMobileOpen(false)}
                  className={`flex items-center rounded-full py-2.5 ${isCollapsed ? "justify-center px-2" : "gap-3 px-3"}`}
                  style={
                    active
                      ? { backgroundColor: "var(--accent-tint)", color: "var(--accent)" }
                      : { color: "var(--foreground-muted)" }
                  }
                  title={isCollapsed ? item.label : undefined}
                >
                  <span
                    className="flex h-9 w-9 items-center justify-center rounded-full"
                    style={active ? { backgroundColor: "color-mix(in srgb, var(--background-elevated) 92%, transparent)" } : undefined}
                  >
                    <NavIcon icon={item.icon} active={active} />
                  </span>
                  {!isCollapsed ? (
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-inherit">{item.label}</span>
                      <span className="block text-xs text-inherit opacity-80">{item.description}</span>
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </nav>

          {showFocusedTaskBanner ? (
            <div className={`mt-3 ${isCollapsed ? "px-0" : "px-1"}`}>
              {isCollapsed ? (
                <Link
                  href="/tasks"
                  className="mx-auto flex h-11 w-11 items-center justify-center rounded-full border transition hover:scale-[1.03]"
                  style={{
                    borderColor: "color-mix(in srgb, var(--accent) 28%, transparent)",
                    backgroundColor: "color-mix(in srgb, var(--accent-tint) 72%, transparent)",
                    boxShadow: "0 0 0 1px color-mix(in srgb, var(--accent) 18%, transparent), var(--shadow-2)",
                  }}
                  title={`Primary focus: ${focusedTask.title}${focusedTask.due_date ? ` · ${formatDueDate(focusedTask.due_date)}` : ""}`}
                >
                  <Target className="h-4 w-4" aria-hidden="true" style={{ color: "var(--accent)" }} />
                </Link>
              ) : (
                <Link
                  href="/tasks"
                  className="relative flex items-start justify-between gap-3 overflow-hidden rounded-2xl border px-3 py-3 transition hover:opacity-95"
                  style={{
                    borderColor: "color-mix(in srgb, var(--accent) 22%, transparent)",
                    background:
                      "linear-gradient(140deg, color-mix(in srgb, var(--accent-tint) 68%, transparent) 0%, color-mix(in srgb, var(--background-elevated) 94%, transparent) 55%)",
                    boxShadow: "var(--shadow-1)",
                  }}
                >
                  <span
                    className="absolute left-0 top-0 h-full w-1"
                    style={{ backgroundColor: "color-mix(in srgb, var(--accent) 72%, transparent)" }}
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <span
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]"
                      style={{
                        color: "var(--accent)",
                        backgroundColor: "color-mix(in srgb, var(--accent-tint) 75%, transparent)",
                      }}
                    >
                      <Target className="h-3 w-3" aria-hidden="true" />
                      Focus now
                    </span>
                    <p className="mt-1 truncate text-sm font-semibold">{focusedTask.title}</p>
                  </div>
                  {focusedTask.due_date ? (
                    <span
                      className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs"
                      style={{
                        color: "var(--foreground-muted)",
                        backgroundColor: "color-mix(in srgb, var(--background) 70%, transparent)",
                      }}
                    >
                      <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                      {formatDueDate(focusedTask.due_date)}
                    </span>
                  ) : null}
                </Link>
              )}
            </div>
          ) : null}

          <div className={`mt-auto space-y-3 ${isCollapsed ? "px-0" : "px-1"} pt-6`}>
            <Link
              href="/logout"
              className={`button-ghost flex items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-medium ${
                isCollapsed ? "mx-auto w-11 px-0" : "w-full"
              }`}
              title={isCollapsed ? "Sign out" : undefined}
            >
              <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
              {isCollapsed ? null : "Sign out"}
            </Link>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="px-4 py-4 sm:px-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  aria-label="Open menu"
                  onClick={() => setIsMobileOpen(true)}
                  className="flex h-10 w-10 items-center justify-center rounded-full lg:hidden"
                  style={{ color: "var(--foreground-muted)" }}
                >
                  <Menu className="h-5 w-5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                  onClick={() => setIsCollapsed((current) => !current)}
                  className="hidden h-10 w-10 items-center justify-center rounded-full lg:flex"
                  style={{ color: "var(--foreground-muted)" }}
                >
                  {isCollapsed ? <PanelLeftOpen className="h-5 w-5" aria-hidden="true" /> : <PanelLeftClose className="h-5 w-5" aria-hidden="true" />}
                </button>
                <h1 className="truncate text-xl font-semibold sm:text-2xl">{currentSection.description}</h1>
              </div>

              <ThemeToggle compact />
            </div>
          </header>

          <main className="min-w-0 flex-1 px-4 pb-6 sm:px-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
