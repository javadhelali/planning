import AppShell from "@/components/site/app-shell";
import Footer from "@/components/site/footer";
import Header from "@/components/site/header";
import { cookies } from "next/headers";

export default async function SiteRouteLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("planning_session")?.value ?? null;

  if (sessionToken) {
    return (
      <div className="min-h-screen" style={{ backgroundColor: "var(--background)", color: "var(--foreground)" }}>
        <AppShell>{children}</AppShell>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--background)", color: "var(--foreground)" }}>
      <Header isAuthenticated={false} />
      {children}
      <Footer />
    </div>
  );
}
