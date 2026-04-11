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
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-6 py-8 md:grid-cols-[220px_1fr]">
        <AdminSidebar />
        <section>{children}</section>
      </div>
    </div>
  );
}
