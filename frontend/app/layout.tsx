import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";

type ThemeMode = "light" | "dark";
const THEME_STORAGE_KEY = "planning_theme";

const isThemeMode = (value: string | null): value is ThemeMode =>
  value === "light" || value === "dark";

export const metadata: Metadata = {
  title: "Planning",
  description: "Minimal task planning workspace with a Material Design 3-inspired interface.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const storedTheme = cookieStore.get(THEME_STORAGE_KEY)?.value ?? null;
  const initialTheme: ThemeMode | undefined = isThemeMode(storedTheme)
    ? storedTheme
    : undefined;

  return (
    <html
      lang="en"
      data-theme={initialTheme}
      style={initialTheme ? { colorScheme: initialTheme } : undefined}
    >
      <body>{children}</body>
    </html>
  );
}
