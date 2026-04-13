"use client";

import { LayoutGrid, ListTodo, LogOut } from "lucide-react";
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
            className="inline-flex items-center gap-2 rounded-full px-4 py-2 font-medium"
            style={pathname === "/" ? { backgroundColor: "var(--accent-tint)", color: "var(--accent)" } : { color: "var(--foreground-muted)" }}
          >
            <ListTodo className="h-4 w-4" aria-hidden="true" />
            Tasks
          </Link>
          <Link
            href="/admin"
            className="inline-flex items-center gap-2 rounded-full px-4 py-2 font-medium"
            style={
              pathname.startsWith("/admin")
                ? { backgroundColor: "var(--accent-tint)", color: "var(--accent)" }
                : { color: "var(--foreground-muted)" }
            }
          >
            <LayoutGrid className="h-4 w-4" aria-hidden="true" />
            Admin
          </Link>
          <Link href="/logout" className="button-secondary inline-flex items-center gap-2 rounded-full px-4 py-2 font-medium">
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Sign out
          </Link>
        </nav>
      </div>
    </header>
  );
}
