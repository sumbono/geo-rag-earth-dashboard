import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AuthGuard from "../components/AuthGuard";

const routerMocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMocks,
}));

const fetchMock = vi.fn<typeof fetch>();

function stubFetch(status: number, body: unknown) {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
}

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  routerMocks.push.mockReset();
  routerMocks.replace.mockReset();
});

describe("AuthGuard", () => {
  it("renders children once GET /auth/me succeeds", async () => {
    stubFetch(200, { username: "demo" });
    render(
      <AuthGuard>
        <p>secret dashboard</p>
      </AuthGuard>,
    );

    // Children stay hidden until the session probe answers.
    expect(screen.queryByText("secret dashboard")).not.toBeInTheDocument();
    expect(await screen.findByText("secret dashboard")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/me",
      expect.objectContaining({ credentials: "include" }),
    );
    expect(routerMocks.replace).not.toHaveBeenCalled();
  });

  it("redirects to /login and withholds children when /auth/me 401s", async () => {
    stubFetch(401, { detail: "Not authenticated" });
    render(
      <AuthGuard>
        <p>secret dashboard</p>
      </AuthGuard>,
    );

    await waitFor(() =>
      expect(routerMocks.replace).toHaveBeenCalledWith("/login"),
    );
    expect(screen.queryByText("secret dashboard")).not.toBeInTheDocument();
  });

  it("recovers from an expired access token via silent refresh (spec §7)", async () => {
    // /auth/me 401 once → POST /auth/refresh 200 → retried probe 200.
    let meCalls = 0;
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/auth/refresh") {
        return new Response(JSON.stringify({ token_type: "bearer" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      meCalls += 1;
      const status = meCalls === 1 ? 401 : 200;
      const body = meCalls === 1 ? { detail: "Not authenticated" } : { username: "demo" };
      return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AuthGuard>
        <p>secret dashboard</p>
      </AuthGuard>,
    );

    // The probe 401'd but the refresh + retry succeeded → children render,
    // no redirect.
    expect(await screen.findByText("secret dashboard")).toBeInTheDocument();
    expect(routerMocks.replace).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(3); // me(401) + refresh + me(200)
    expect(String(fetchMock.mock.calls[1][0])).toBe("/api/auth/refresh");
  });

  it("redirects to /login when the probe 401s and silent refresh fails", async () => {
    fetchMock.mockImplementation(async () => {
      return new Response(JSON.stringify({ detail: "Not authenticated" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AuthGuard>
        <p>secret dashboard</p>
      </AuthGuard>,
    );

    await waitFor(() =>
      expect(routerMocks.replace).toHaveBeenCalledWith("/login"),
    );
    expect(screen.queryByText("secret dashboard")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2); // probe + failed refresh
  });
});
