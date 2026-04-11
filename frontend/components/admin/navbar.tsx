import Link from "next/link";

export default function AdminNavbar() {
  return (
    <header className="border-b" style={{ borderColor: "var(--card-border)" }}>
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
        <h1 className="text-lg font-semibold">Admin</h1>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/">Home</Link>
          <Link href="/logout">Logout</Link>
        </nav>
      </div>
    </header>
  );
}
