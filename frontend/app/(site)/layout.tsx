import Footer from "@/components/site/footer";
import Header from "@/components/site/header";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export default async function SiteRouteLayout({
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
      <Header isAuthenticated />
      {children}
      <Footer />
    </div>
  );
}
