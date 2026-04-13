"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

import { post } from "../utilities/api";

const SESSION_STORAGE_KEY = "planning_session";
const SESSION_COOKIE_KEY = "planning_session";
const SESSION_COOKIE_TTL_SECONDS = 60 * 60 * 24 * 7;

type LoginResponse = {
  token: string;
  user: {
    id: number;
    username: string;
  };
};

async function readErrorMessage(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (typeof payload?.detail === "string") return payload.detail;
  return `Request failed (${response.status})`;
}

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>("Sign in to continue to your workspace.");

  useEffect(() => {
    const token = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (token) {
      window.location.replace("/");
    }
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanedUsername = username.trim().toLowerCase();
    if (!cleanedUsername || !password) return;

    setIsSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      if (isRegisterMode) {
        const registerResponse = await post("/auth/register", {
          username: cleanedUsername,
          password,
        });

        if (!registerResponse.ok) {
          throw new Error(await readErrorMessage(registerResponse));
        }
      }

      const loginResponse = await post("/auth/login", {
        username: cleanedUsername,
        password,
      });
      if (!loginResponse.ok) {
        throw new Error(await readErrorMessage(loginResponse));
      }

      const payload = (await loginResponse.json()) as LoginResponse;
      window.localStorage.setItem(SESSION_STORAGE_KEY, payload.token);
      document.cookie = `${SESSION_COOKIE_KEY}=${encodeURIComponent(payload.token)}; path=/; max-age=${SESSION_COOKIE_TTL_SECONDS}; samesite=lax`;
      window.location.replace("/");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to authenticate user");
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitLabel = isRegisterMode ? "Create account" : "Sign in";
  const busyLabel = isRegisterMode ? "Creating account..." : "Signing in...";

  const toggleMode = () => {
    if (isSubmitting) return;
    setError(null);
    setIsRegisterMode((prev) => !prev);
    setMessage(
      isRegisterMode
        ? "Sign in to continue to your workspace."
        : "Create an account with a username and password.",
    );
  };

  return (
    <main className="content-width mx-auto px-4 py-10 sm:px-6 sm:py-14">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_440px]">
        <section className="surface-card rounded-[28px] px-6 py-8 sm:px-8 sm:py-10">
          <span
            className="inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]"
            style={{ backgroundColor: "var(--accent-tint)", color: "var(--accent)" }}
          >
            Planning
          </span>
          <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-5xl">
            Sign in to a cleaner task workflow.
          </h1>
          <p className="mt-4 max-w-xl text-base leading-7" style={{ color: "var(--foreground-muted)" }}>
            Keep your day focused with a minimal task list, safer updates, and a Material Design 3-inspired visual system.
          </p>
          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            {[
              ["Focused lists", "Keep open work visible without clutter."],
              ["Clear status updates", "Review changes before they are saved."],
              ["Material surfaces", "Readable, low-noise UI inspired by Material Design 3."],
            ].map(([title, description]) => (
              <article key={title} className="surface-subtle rounded-3xl p-4">
                <h2 className="text-sm font-semibold">{title}</h2>
                <p className="mt-2 text-sm leading-6" style={{ color: "var(--foreground-muted)" }}>
                  {description}
                </p>
              </article>
            ))}
          </div>
          <Link href="/" className="button-ghost mt-8 inline-flex rounded-full px-4 py-2 text-sm font-medium">
            Back to overview
          </Link>
        </section>

        <section className="surface-card rounded-[28px] p-6 sm:p-7">
          <h2 className="text-2xl font-semibold">{isRegisterMode ? "Create account" : "Sign in"}</h2>
          <p className="mt-2 text-sm leading-6" style={{ color: "var(--foreground-muted)" }}>
            {message}
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="username" className="text-sm font-semibold">
                Username
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="field mt-2 rounded-2xl px-4 py-3 text-sm"
                placeholder="your-username"
                minLength={3}
                maxLength={64}
                required
              />
            </div>

            <div>
              <label htmlFor="password" className="text-sm font-semibold">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="field mt-2 rounded-2xl px-4 py-3 text-sm"
                placeholder="Enter your password"
                minLength={8}
                maxLength={128}
                required
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="button-primary w-full rounded-2xl px-4 py-3 text-sm font-semibold"
            >
              {isSubmitting ? busyLabel : submitLabel}
            </button>
          </form>

          <button
            type="button"
            onClick={toggleMode}
            className="button-ghost mt-3 rounded-full px-4 py-2 text-sm font-medium"
          >
            {isRegisterMode ? "Already have an account? Sign in" : "Need an account? Create one"}
          </button>

          {error ? (
            <p className="notice-error mt-4 rounded-3xl px-4 py-3 text-sm" aria-live="polite">
              {error}
            </p>
          ) : null}
        </section>
      </div>
    </main>
  );
}
