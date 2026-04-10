import Link from "next/link";

export default function AdminSidebar() {
  return (
    <aside className="rounded-2xl border p-4" style={{ borderColor: "var(--card-border)" }}>
      <nav className="flex flex-col gap-2 text-sm">
        <Link href="/admin">Dashboard</Link>
        <Link href="/admin/users">Users</Link>
        <Link href="/admin/products">Products</Link>
        <Link href="/admin/settings">Settings</Link>
      </nav>
    </aside>
  );
}
