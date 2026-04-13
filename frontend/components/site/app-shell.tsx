"use client";

import {
  LayoutGrid,
  ListTodo,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";

import ThemeToggle from "@/components/site/theme-toggle";

type AppShellProps = {
  children: ReactNode;
};

type NavItem = {
  href: string;
  label: string;
  description: string;
  icon: "tasks" | "admin";
};

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Tasks", description: "Task space", icon: "tasks" },
  { href: "/admin", label: "Admin", description: "Workspace controls", icon: "admin" },
];

function NavIcon({ icon, active }: { icon: NavItem["icon"]; active: boolean }) {
  const className = "h-5 w-5";

  if (icon === "admin") {
    return <LayoutGrid aria-hidden="true" className={className} color={active ? "var(--accent)" : "var(--foreground-muted)"} />;
  }

  return <ListTodo aria-hidden="true" className={className} color={active ? "var(--accent)" : "var(--foreground-muted)"} />;
}

function isItemActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export default function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const currentSection = NAV_ITEMS.find((item) => isItemActive(pathname, item.href)) ?? NAV_ITEMS[0];
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("planning_sidebar_collapsed") === "true";
  });
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  useEffect(() => {
    window.localStorage.setItem("planning_sidebar_collapsed", String(isCollapsed));
  }, [isCollapsed]);

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
