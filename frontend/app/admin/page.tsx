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
        <h1 className="text-2xl font-semibold">Admin Dashboard</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--muted-foreground)" }}>
          Choose an area to manage. Core sections are surfaced first for faster access.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {ADMIN_SECTIONS.map((section) => (
          <article
            key={section.href}
            className="rounded-2xl border p-4"
            style={{ borderColor: "var(--card-border)", backgroundColor: "var(--card)" }}
          >
            <h2 className="text-base font-semibold">{section.title}</h2>
            <p className="mt-1 text-sm" style={{ color: "var(--muted-foreground)" }}>
              {section.description}
            </p>
            <Link
              href={section.href}
              className="mt-4 inline-flex rounded-xl border px-3 py-2 text-sm font-medium"
              style={{ borderColor: "var(--card-border)" }}
            >
              Open {section.title}
            </Link>
          </article>
        ))}
      </section>
    </main>
  );
}
