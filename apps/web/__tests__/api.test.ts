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
