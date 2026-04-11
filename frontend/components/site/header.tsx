import Link from "next/link";

type HeaderProps = {
  isAuthenticated: boolean;
};

export default function Header({ isAuthenticated }: HeaderProps) {
  return (
    <header className="border-b" style={{ borderColor: "var(--card-border)" }}>
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="text-lg font-semibold">
          Planning
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/">Home</Link>
          <Link href="/admin">Admin</Link>
          {isAuthenticated ? <Link href="/logout">Logout</Link> : <Link href="/login">Login</Link>}
        </nav>
      </div>
    </header>
  );
}
