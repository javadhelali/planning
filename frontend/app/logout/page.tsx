"use client";

import { useEffect } from "react";

import { post } from "../utilities/api";

const SESSION_STORAGE_KEY = "planning_session";
const SESSION_COOKIE_KEY = "planning_session";

export default function LogoutPage() {
  useEffect(() => {
    const runLogout = async () => {
      const token = window.localStorage.getItem(SESSION_STORAGE_KEY);

      if (token) {
        try {
          await post("/auth/logout", {});
        } catch {
          // Ignore logout API errors; local session clear still signs user out.
        }
      }

      window.localStorage.removeItem(SESSION_STORAGE_KEY);
      document.cookie = `${SESSION_COOKIE_KEY}=; path=/; max-age=0`;
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
