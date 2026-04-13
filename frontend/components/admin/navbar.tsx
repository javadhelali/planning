"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function AdminNavbar() {
  const pathname = usePathname();

  return (
    <header className="border-b" style={{ borderColor: "var(--card-border)" }}>
      <div className="content-width mx-auto flex flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <div>
          <p className="text-lg font-semibold">Admin</p>
          <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>
            Workspace management
          </p>
        </div>
        <nav className="flex items-center gap-2 text-sm">
          <Link
            href="/"
            className="rounded-full px-4 py-2 font-medium"
            style={pathname === "/" ? { backgroundColor: "var(--accent-tint)", color: "var(--accent)" } : { color: "var(--foreground-muted)" }}
          >
            Tasks
          </Link>
          <Link
            href="/admin"
            className="rounded-full px-4 py-2 font-medium"
            style={
              pathname.startsWith("/admin")
                ? { backgroundColor: "var(--accent-tint)", color: "var(--accent)" }
                : { color: "var(--foreground-muted)" }
            }
          >
            Admin
          </Link>
          <Link href="/logout" className="button-secondary rounded-full px-4 py-2 font-medium">
            Sign out
          </Link>
        </nav>
      </div>
    </header>
  );
}
