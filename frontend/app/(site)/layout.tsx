import Footer from "@/components/site/footer";
import Header from "@/components/site/header";

export default function SiteRouteLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--background)", color: "var(--foreground)" }}>
      <Header />
      {children}
      <Footer />
    </div>
  );
}
