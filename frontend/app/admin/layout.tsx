import AdminNavbar from "@/components/admin/navbar";
import AdminSidebar from "@/components/admin/sidebar";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export default async function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("planning_session")?.value ?? null;
  if (!sessionToken) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--background)", color: "var(--foreground)" }}>
      <AdminNavbar />
      <div className="content-width mx-auto grid grid-cols-1 gap-6 px-4 py-8 sm:px-6 md:grid-cols-[240px_1fr]">
        <AdminSidebar />
        <section className="surface-card rounded-[28px] p-6 sm:p-7">{children}</section>
      </div>
    </div>
  );
}
