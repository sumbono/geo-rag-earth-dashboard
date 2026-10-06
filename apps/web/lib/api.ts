/**
 * Thin fetch wrapper for the proxied `/api/*` backend.
 *
 * Cookies are the session (single-origin design), so every request includes
 * them; non-2xx responses throw `ApiError` carrying the HTTP status and —
 * when present — the server's human-readable message. The backend emits two
 * error-body shapes and both are tolerated: FastAPI's `{"detail": ...}`
 * (401/404/422, detail may be a string or a validation-error array) and
 * slowapi's `{"error": ...}` (429 rate limit).
 */

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message?: string) {
    super(message ?? `API request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
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

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(path, { ...init, credentials: "include" });
  const body = await readBody(response);

  if (!response.ok) {
    throw new ApiError(response.status, extractMessage(body));
  }
  return body as T;
}
