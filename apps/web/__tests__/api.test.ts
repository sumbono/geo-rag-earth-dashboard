import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch } from "../lib/api";

const fetchMock = vi.fn<typeof fetch>();

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

function stubFetch(status: number, body: unknown, contentType = "application/json") {
  fetchMock.mockResolvedValue(
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": contentType },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
}

describe("apiFetch", () => {
  it("always sends credentials: include", async () => {
    stubFetch(200, { status: "ok" });

    await apiFetch("/api/health");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/health",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("forces credentials: include even when init requests otherwise", async () => {
    stubFetch(200, {});

    await apiFetch("/api/auth/logout", { method: "POST", credentials: "omit" });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.credentials).toBe("include");
  });

  it("resolves the parsed JSON body on 2xx", async () => {
    stubFetch(200, { status: "ok" });

    await expect(apiFetch<{ status: string }>("/api/health")).resolves.toEqual({
      status: "ok",
    });
  });

  it("throws ApiError with FastAPI's {detail} body shape", async () => {
    stubFetch(401, { detail: "Invalid credentials" });

    const err = await apiFetch("/api/auth/token", { method: "POST" }).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
    expect((err as ApiError).message).toContain("Invalid credentials");
  });

  it("throws ApiError with slowapi's {error} body shape (429)", async () => {
    stubFetch(429, { error: "Rate limit exceeded: 5 per 1 minute" });

    const err = await apiFetch("/api/auth/token", { method: "POST" }).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(429);
    expect((err as ApiError).message).toContain("Rate limit exceeded");
  });

  it("still throws ApiError when the error body is not JSON", async () => {
    stubFetch(500, "boom", "text/plain");

    const err = await apiFetch("/api/health").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(500);
  });
});

/** JSON Response factory for route-stubbed fetch mocks. */
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Route-dispatching fetch stub: `routes[url]()` answers each call. */
function stubRoutes(routes: Record<string, () => Response>) {
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    const handler = routes[url];
    if (!handler) throw new Error(`unexpected fetch: ${url}`);
    return handler();
  });
  vi.stubGlobal("fetch", fetchMock);
}

describe("silent refresh (spec §7)", () => {
  it("401 → refresh succeeds → retries once and returns the original data", async () => {
    let targetCalls = 0;
    stubRoutes({
      "/api/search/vector": () =>
        ++targetCalls === 1
          ? jsonResponse(401, { detail: "Not authenticated" })
          : jsonResponse(200, { results: [{ id: "tile-1" }] }),
      "/api/auth/refresh": () => jsonResponse(200, { token_type: "bearer" }),
    });

    await expect(
      apiFetch<{ results: unknown[] }>("/api/search/vector", { method: "POST" }),
    ).resolves.toEqual({ results: [{ id: "tile-1" }] });

    // Exactly 2 fetches to the target + 1 refresh, in that order.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      "/api/search/vector",
      "/api/auth/refresh",
      "/api/search/vector",
    ]);
    // The refresh is a plain POST with cookies; the retry repeats the
    // original init.
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: "POST",
      credentials: "include",
    });
  });

  it("401 → refresh fails → throws a distinguishable needsLogin error", async () => {
    stubRoutes({
      "/api/auth/me": () => jsonResponse(401, { detail: "Not authenticated" }),
      "/api/auth/refresh": () => jsonResponse(401, { detail: "Not authenticated" }),
    });

    const err = await apiFetch("/api/auth/me").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
    expect((err as ApiError).needsLogin).toBe(true);
    expect((err as ApiError).message).toContain("Not authenticated");
    expect(fetchMock).toHaveBeenCalledTimes(2); // target + refresh, no retry
  });

  it("401 → refresh network failure → needsLogin (treated as refresh failure)", async () => {
    fetchMock.mockImplementation(async (input) => {
      if (String(input) === "/api/auth/refresh") {
        throw new TypeError("network down");
      }
      return jsonResponse(401, { detail: "Not authenticated" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const err = await apiFetch("/api/auth/me").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
    expect((err as ApiError).needsLogin).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("second 401 after the retry does NOT loop (no third attempt)", async () => {
    stubRoutes({
      "/api/auth/me": () => jsonResponse(401, { detail: "Not authenticated" }),
      "/api/auth/refresh": () => jsonResponse(200, { token_type: "bearer" }),
    });

    const err = await apiFetch("/api/auth/me").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
    expect((err as ApiError).needsLogin).toBe(true);
    // 2 target fetches + 1 refresh — never a third attempt to the target.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(
      fetchMock.mock.calls.filter((call) => String(call[0]) === "/api/auth/me"),
    ).toHaveLength(2);
  });

  it("never refreshes on /api/auth/token (wrong password ≠ expired session)", async () => {
    stubRoutes({
      "/api/auth/token": () =>
        jsonResponse(401, { detail: "Incorrect username or password" }),
    });

    const err = await apiFetch("/api/auth/token", { method: "POST" }).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
    expect((err as ApiError).needsLogin).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
