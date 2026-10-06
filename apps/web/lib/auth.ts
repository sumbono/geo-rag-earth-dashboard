/**
 * Session helper (Task 16): sign out and land on the public login page.
 *
 * `logout()` best-efforts `POST /api/auth/logout` (server revokes the
 * presented refresh row and clears both cookies) and then navigates to
 * `/login` regardless of the POST's outcome — a failed call (expired access
 * token, API down) must never trap the user on an authenticated view; the
 * cookies are httpOnly and die server-side on their own schedule.
 *
 * `navigate` defaults to a full-page location change (logout should reset
 * every bit of client state) and exists as a seam because jsdom cannot
 * navigate — production callers just use `logout()`.
 */
import { apiFetch } from "./api";

type Navigate = (href: string) => void;

const fullPageNavigate: Navigate = (href) => {
  window.location.assign(href);
};

export async function logout(navigate: Navigate = fullPageNavigate): Promise<void> {
  try {
    await apiFetch("/api/auth/logout", { method: "POST" });
  } catch {
    // Best-effort: fall through to the redirect either way (see docstring).
  }
  navigate("/login");
}
