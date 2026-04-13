import Link from "next/link";

const ADMIN_SECTIONS = [
  {
    href: "/admin/users",
    title: "Users",
    description: "Manage access, roles, and account states.",
  },
  {
    href: "/admin/products",
    title: "Products",
    description: "Maintain catalog content and product visibility.",
  },
  {
    href: "/admin/settings",
    title: "Settings",
    description: "Configure workspace behavior and defaults.",
  },
];

export default function AdminPage() {
  return (
    <main className="space-y-6">
      <header>
        <span
          className="inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]"
          style={{ backgroundColor: "var(--accent-tint)", color: "var(--accent)" }}
        >
          Admin
        </span>
        <h1 className="mt-4 text-2xl font-semibold">Admin dashboard</h1>
        <p className="mt-2 text-sm leading-6" style={{ color: "var(--foreground-muted)" }}>
          Choose an area to manage. Core sections are surfaced first for faster access.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {ADMIN_SECTIONS.map((section) => (
          <article
            key={section.href}
            className="surface-subtle rounded-3xl p-5"
          >
            <h2 className="text-base font-semibold">{section.title}</h2>
            <p className="mt-2 text-sm leading-6" style={{ color: "var(--foreground-muted)" }}>
              {section.description}
            </p>
            <Link
              href={section.href}
              className="button-secondary mt-5 inline-flex rounded-2xl px-4 py-3 text-sm font-medium"
            >
              Open {section.title}
            </Link>
          </article>
        ))}
      </section>
    </main>
  );
}
