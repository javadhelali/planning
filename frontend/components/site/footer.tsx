export default function Footer() {
  return (
    <footer className="border-t" style={{ borderColor: "var(--card-border)" }}>
      <div
        className="content-width mx-auto flex flex-col gap-1 px-4 py-5 text-sm sm:px-6"
        style={{ color: "var(--foreground-muted)" }}
      >
        <p>Planning workspace</p>
        <p className="text-xs">Minimal task management with Material Design 3-inspired surfaces and controls.</p>
      </div>
    </footer>
  );
}
