"use client";

import { LayoutGrid, Package2, Settings, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function AdminSidebar() {
  const pathname = usePathname();
  const items = [
    { href: "/admin", label: "Dashboard", icon: LayoutGrid },
    { href: "/admin/users", label: "Users", icon: Users },
    { href: "/admin/products", label: "Products", icon: Package2 },
    { href: "/admin/settings", label: "Settings", icon: Settings },
  ];

  return (
    <aside className="surface-card rounded-[28px] p-4">
      <nav className="flex flex-col gap-2 text-sm">
        {items.map((item) => {
          const isActive =
            item.href === "/admin"
              ? pathname === "/admin"
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className="inline-flex items-center gap-3 rounded-2xl px-4 py-3 font-medium"
              style={
                isActive
                  ? { backgroundColor: "var(--accent-tint)", color: "var(--accent)" }
                  : { color: "var(--foreground-muted)" }
              }
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
