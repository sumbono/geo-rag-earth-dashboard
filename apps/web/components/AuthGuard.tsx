"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../lib/api";

/**
 * Client-side gate for the dashboard (Task 16): on mount, prove the access
 * cookie still resolves to a user via `GET /api/auth/me`, then reveal the
 * children. Anything but a successful probe (401 for an absent/expired
 * session, plus network/API failures — which must never expose authenticated
 * content) routes to `/login`.
 *
 * The route change uses `router.replace` rather than `next/navigation`'s
 * `redirect()`: inside an effect (async, post-render) the router method is
 * the supported client equivalent, and `replace` keeps Back from bouncing
 * straight back into a dead guard. Nothing renders while the probe is in
 * flight, so unauthenticated visitors never see the wrapped content.
 *
 * Spec §7: `apiFetch` already attempts ONE silent refresh when the probe
 * 401s (expired access + valid refresh cookie → the retried probe succeeds
 * and the guard never fires). Reaching the catch therefore means the
 * refresh failed too — the distinguishable `ApiError(401, {needsLogin:
 * true})` — or the API is unreachable; either way the existing pattern
 * applies: hard-route to `/login`, never render authenticated content.
 */
export default function AuthGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [status, setStatus] = useState<"checking" | "ok" | "denied">("checking");

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ username: string }>("/api/auth/me")
      .then(() => {
        if (!cancelled) setStatus("ok");
      })
      .catch(() => {
        if (cancelled) return;
        // The auth-expired signal (`ApiError` with `needsLogin: true` after
        // a failed silent refresh) and network errors both land here —
        // route to /login either way (see docstring).
        setStatus("denied");
        router.replace("/login");
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (status !== "ok") return null;
  return <>{children}</>;
}
