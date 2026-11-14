"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch } from "../lib/api";

/**
 * Dashboard chrome (P0/P1 Task 1): wordmark home link, GitHub, an optional
 * Share slot (Task 5 wires `onShare`), and Log out. Logout POSTs
 * `/api/auth/logout` (clears the refresh row + cookies server-side) then
 * routes to /login — a failed POST still routes, because a dead session is
 * exactly when logout matters (matches AuthGuard's router.replace pattern).
 */
export default function AppHeader({ onShare }: { onShare?: () => void }) {
  const router = useRouter();
  async function handleLogout() {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } catch {
      // session may already be dead — route to login either way
    }
    router.replace("/login");
  }
  return (
    <header className="dash-header">
      <Link href="/" className="dash-header__brand">Geo-RAG Earth Dashboard</Link>
      <nav className="dash-header__actions">
        <a
          className="button button--ghost"
          href="https://github.com/sumbono/geo-rag-earth-dashboard"
        >
          GitHub
        </a>
        {onShare && (
          <button
            type="button"
            className="button button--ghost"
            data-testid="share-button"
            onClick={onShare}
          >
            Share
          </button>
        )}
        <button type="button" className="button button--ghost" onClick={handleLogout}>
          Log out
        </button>
      </nav>
    </header>
  );
}
