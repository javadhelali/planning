"use client";

import { FormEvent, useState } from "react";

export default function LoginPage() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage(null);

    await new Promise((resolve) => setTimeout(resolve, 500));

    setIsSubmitting(false);
    setMessage("Sign-in flow is ready for backend integration.");
  };

  return (
    <main className="mx-auto flex min-h-[calc(100vh-120px)] w-full max-w-md items-center px-6 py-12">
      <section
        className="w-full rounded-2xl border p-6"
        style={{ borderColor: "var(--card-border)", backgroundColor: "var(--card)" }}
      >
        <h1 className="text-2xl font-semibold">Login</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--muted-foreground)" }}>
          Sign in to continue to your workspace.
        </p>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label htmlFor="email" className="text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              type="email"
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none"
              style={{ borderColor: "var(--card-border)", backgroundColor: "var(--background)" }}
              placeholder="you@example.com"
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
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none"
              style={{ borderColor: "var(--card-border)", backgroundColor: "var(--background)" }}
              placeholder="Enter your password"
              required
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-xl px-3 py-2 text-sm font-medium text-white"
            style={{ backgroundColor: "var(--accent)" }}
          >
            {isSubmitting ? "Signing in..." : "Sign in"}
          </button>
        </form>

        {message ? (
          <p className="mt-3 text-sm" style={{ color: "var(--muted-foreground)" }} aria-live="polite">
            {message}
          </p>
        ) : null}
      </section>
    </main>
  );
}
