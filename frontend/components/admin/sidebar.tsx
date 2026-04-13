"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function AdminSidebar() {
  const pathname = usePathname();
  const items = [
    { href: "/admin", label: "Dashboard" },
    { href: "/admin/users", label: "Users" },
    { href: "/admin/products", label: "Products" },
    { href: "/admin/settings", label: "Settings" },
  ];

  return (
    <aside className="surface-card rounded-[28px] p-4">
      <nav className="flex flex-col gap-2 text-sm">
        {items.map((item) => {
          const isActive =
            item.href === "/admin"
              ? pathname === "/admin"
              : pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-2xl px-4 py-3 font-medium"
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
      </nav>
    </aside>
  );
}
