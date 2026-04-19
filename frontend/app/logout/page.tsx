"use client";

import { useEffect } from "react";

import { clearPlanningSession, getPlanningToken, post } from "../utilities/api";

export default function LogoutPage() {
  useEffect(() => {
    const runLogout = async () => {
      const token = getPlanningToken();

      if (token) {
        try {
          await post("/auth/logout", {});
        } catch {
          // Ignore logout API errors; local session clear still signs user out.
        }
      }

      clearPlanningSession();
      window.location.replace("/login");
    };

    void runLogout();
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl items-center justify-center px-6 py-12">
      <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
        Signing you out...
      </p>
    </main>
  );
}
