"use client";

import { LogIn, LogOut } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

type HeaderProps = {
  isAuthenticated: boolean;
};

export default function Header({ isAuthenticated }: HeaderProps) {
  const pathname = usePathname();
  const navItems = isAuthenticated
    ? [
        { href: "/", label: "Tasks" },
        { href: "/okrs", label: "OKRs" },
        { href: "/admin", label: "Admin" },
      ]
    : [{ href: "/", label: "Overview" }];

  return (
    <header className="border-b" style={{ borderColor: "var(--card-border)" }}>
      <div className="content-width mx-auto flex flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <Link href="/" className="flex items-center gap-3">
          <span
            className="flex h-10 w-10 items-center justify-center rounded-2xl text-sm font-semibold"
            style={{ backgroundColor: "var(--accent-tint)", color: "var(--accent)" }}
          >
            P
          </span>
          <span>
            <span className="block text-lg font-semibold leading-none">Planning</span>
            <span className="block text-xs" style={{ color: "var(--foreground-muted)" }}>
              Material Design 3-inspired workspace
            </span>
          </span>
        </Link>

        <nav className="flex items-center gap-2 text-sm">
          {navItems.map((item) => {
            const isActive =
              item.href === "/"
                ? pathname === "/"
                : pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-full px-4 py-2 font-medium"
                style={
                  isActive
                    ? { backgroundColor: "var(--accent-tint)", color: "var(--accent)" }
                    : { color: "var(--foreground-muted)" }
                }
              >
                {item.label}
              </Link>
            );
          })}
          {isAuthenticated ? (
            <Link href="/logout" className="button-secondary inline-flex items-center gap-2 rounded-full px-4 py-2 font-medium">
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Sign out
            </Link>
          ) : (
            <Link href="/login" className="button-primary inline-flex items-center gap-2 rounded-full px-4 py-2 font-medium">
              <LogIn className="h-4 w-4" aria-hidden="true" />
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
