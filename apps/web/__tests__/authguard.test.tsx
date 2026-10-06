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
});
