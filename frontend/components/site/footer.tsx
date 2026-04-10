export default function Footer() {
  return (
    <footer className="border-t" style={{ borderColor: "var(--card-border)" }}>
      <div className="mx-auto w-full max-w-6xl px-6 py-4 text-sm" style={{ color: "var(--muted-foreground)" }}>
        Built with Next.js
      </div>
    </footer>
  );
}
