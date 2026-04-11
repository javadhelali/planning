"use client";

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
  const [message, setMessage] = useState("Sign in to continue to your workspace.");

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
    <main className="mx-auto flex min-h-[calc(100vh-120px)] w-full max-w-md items-center px-6 py-12">
      <section
        className="w-full rounded-2xl border p-6"
        style={{ borderColor: "var(--card-border)", backgroundColor: "var(--card)" }}
      >
        <h1 className="text-2xl font-semibold">Login</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--muted-foreground)" }}>
          {message}
        </p>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label htmlFor="username" className="text-sm font-medium">
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none"
              style={{ borderColor: "var(--card-border)", backgroundColor: "var(--background)" }}
              placeholder="your-username"
              minLength={3}
              maxLength={64}
              required
            />
          </div>

          <div>
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none"
              style={{ borderColor: "var(--card-border)", backgroundColor: "var(--background)" }}
              placeholder="Enter your password"
              minLength={8}
              maxLength={128}
              required
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-xl px-3 py-2 text-sm font-medium text-white"
            style={{ backgroundColor: "var(--accent)" }}
          >
            {isSubmitting ? busyLabel : submitLabel}
          </button>
        </form>

        <button
          type="button"
          onClick={toggleMode}
          className="mt-3 text-sm underline"
          style={{ color: "var(--muted-foreground)" }}
        >
          {isRegisterMode ? "Already have an account? Sign in" : "Need an account? Create one"}
        </button>

        {error ? (
          <p className="mt-3 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "#ef4444", color: "#ef4444" }} aria-live="polite">
            {error}
          </p>
        ) : null}
      </section>
    </main>
  );
}
