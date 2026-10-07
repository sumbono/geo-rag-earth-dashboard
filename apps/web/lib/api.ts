import type { SearchResult } from "./types";

/**
 * Thin fetch wrapper for the proxied `/api/*` backend.
 *
 * Cookies are the session (single-origin design), so every request includes
 * them; non-2xx responses throw `ApiError` carrying the HTTP status and —
 * when present — the server's human-readable message. The backend emits two
 * error-body shapes and both are tolerated: FastAPI's `{"detail": ...}`
 * (401/404/422, detail may be a string or a validation-error array) and
 * slowapi's `{"error": ...}` (429 rate limit).
 *
 * Spec §7 — silent refresh: the access cookie lives 15 min; when a request
 * answers 401, `apiFetch` makes exactly ONE attempt to rotate the refresh
 * cookie (`POST /api/auth/refresh`) and, on a 200 there, retries the original
 * request once. Refresh failure (401/403/network) or a second 401 after the
 * retry throws `ApiError` with `needsLogin: true` so callers can hard-route
 * to `/login`. The refresh itself is a raw `fetch` (never `apiFetch`), and
 * concurrent 401s share one in-flight refresh, so neither recursion nor a
 * stampede can loop — and a replayed rotation never trips the backend's
 * refresh-family revocation.
 */

export class ApiError extends Error {
  readonly status: number;
  /** True when the session is gone: refresh failed or the retried request
   * still 401'd — callers should treat this as "route to /login". */
  readonly needsLogin: boolean;

  constructor(
    status: number,
    message?: string,
    options?: { needsLogin?: boolean },
  ) {
    super(message ?? `API request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.needsLogin = options?.needsLogin ?? false;
  }
}

function extractMessage(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const record = body as Record<string, unknown>;
  const candidate = record.detail ?? record.error;
  if (typeof candidate === "string") return candidate;
  // FastAPI 422 validation errors: [{"loc": [...], "msg": "..."}, ...]
  if (Array.isArray(candidate)) {
    const msgs = candidate
      .map((item) =>
        typeof item === "object" && item !== null
          ? (item as Record<string, unknown>).msg
          : undefined,
      )
      .filter((msg): msg is string => typeof msg === "string");
    if (msgs.length > 0) return msgs.join("; ");
  }
  return undefined;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === "") return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

const REFRESH_PATH = "/api/auth/refresh";

/**
 * Endpoints whose own 401 is an answer about the presented credentials, not
 * an expired access token: a wrong password (token) must not trigger a
 * refresh round-trip, and refreshing the refresh endpoint would recurse.
 * `/auth/me`, `/auth/logout` and every data route DO refresh — a mid-session
 * expiry there is exactly the spec §7 case.
 */
const NO_SILENT_REFRESH = new Set(["/api/auth/token", REFRESH_PATH]);

/** One refresh at a time: parallel 401s await the same rotation instead of
 * racing two posts of the same one-time cookie (reuse → family revocation). */
let refreshInFlight: Promise<boolean> | null = null;

function trySilentRefresh(): Promise<boolean> {
  if (refreshInFlight === null) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch(REFRESH_PATH, {
          method: "POST",
          credentials: "include",
        });
        return res.ok;
      } catch {
        return false; // network failure counts as "refresh failed"
      }
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function fetchOnce(path: string, init?: RequestInit): Promise<Response> {
  return fetch(path, { ...init, credentials: "include" });
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
  retried = false,
): Promise<T> {
  const response = await fetchOnce(path, init);

  if (response.status === 401 && !retried && !NO_SILENT_REFRESH.has(path)) {
    if (await trySilentRefresh()) {
      // Retry exactly once (`retried` blocks any third attempt).
      return apiFetch<T>(path, init, true);
    }
    // Refresh failed → the session is gone; signal callers to /login.
    const body = await readBody(response);
    throw new ApiError(401, extractMessage(body), { needsLogin: true });
  }

  const body = await readBody(response);

  if (!response.ok) {
    throw new ApiError(
      response.status,
      extractMessage(body),
      response.status === 401 && !NO_SILENT_REFRESH.has(path)
        ? { needsLogin: true }
        : undefined,
    );
  }
  return body as T;
}

/**
 * One ranked vector search (`POST /api/search/vector`) — shared by the
 * SearchBar submit and the empty state's suggestion clicks so a suggestion
 * runs exactly the same single POST a manual search does.
 */
export async function searchVector(query: string): Promise<SearchResult[]> {
  const data = await apiFetch<{ results: SearchResult[] }>(
    "/api/search/vector",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    },
  );
  return data.results;
}
