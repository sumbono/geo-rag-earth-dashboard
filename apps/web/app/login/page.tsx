"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiFetch } from "../../lib/api";

/**
 * Public login form (Task 16).
 *
 * Submits username/password as `application/x-www-form-urlencoded` to
 * `POST /api/auth/token` via `apiFetch` (cookies included); the backend sets
 * the httpOnly access/refresh cookie pair on 200. Success enters the
 * dashboard; any 401 renders the fixed inline text "Invalid credentials" —
 * the backend's detail wording is deliberately not surfaced here.
 */
export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/api/auth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ username, password }),
      });
      router.push("/dashboard");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError("Invalid credentials");
      } else if (err instanceof ApiError) {
        // Rate limits (slowapi {error}) and other API messages are useful;
        // the 401 branch above owns the credentials wording.
        setError(err.message);
      } else {
        setError("Something went wrong. Please try again.");
      }
      setSubmitting(false);
    }
  }

  return (
    <main className="auth">
      <section className="auth__card" aria-labelledby="login-title">
        <h1 id="login-title">Log in</h1>
        <form className="auth__form" onSubmit={handleSubmit} noValidate>
          <div className="auth__field">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
          </div>
          <div className="auth__field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>
          {error !== null && (
            <p className="auth__error" role="alert">
              {error}
            </p>
          )}
          <button
            className="button button--primary auth__submit"
            type="submit"
            disabled={submitting}
          >
            {submitting ? "Logging in…" : "Log in"}
          </button>
        </form>
      </section>
    </main>
  );
}
