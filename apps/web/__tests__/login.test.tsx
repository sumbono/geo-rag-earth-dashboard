import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LoginPage from "../app/login/page";
import { logout } from "../lib/auth";

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

function fillAndSubmit(username: string, password: string) {
  fireEvent.change(screen.getByLabelText(/username/i), {
    target: { value: username },
  });
  fireEvent.change(screen.getByLabelText(/password/i), {
    target: { value: password },
  });
  fireEvent.click(screen.getByRole("button", { name: /log in/i }));
}

describe("login page", () => {
  it("POSTs form-urlencoded credentials and pushes /dashboard on 200", async () => {
    stubFetch(200, { token_type: "bearer" });
    render(<LoginPage />);
    fillAndSubmit("demo", "demo-pass-123");

    await waitFor(() =>
      expect(routerMocks.push).toHaveBeenCalledWith("/dashboard"),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/auth/token");
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("include");
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(String(init?.body)).toBe("username=demo&password=demo-pass-123");
  });

  it("shows inline 'Invalid credentials' on 401 and does not navigate", async () => {
    stubFetch(401, { detail: "Incorrect username or password" });
    render(<LoginPage />);
    fillAndSubmit("demo", "wrong-password");

    expect(await screen.findByText("Invalid credentials")).toBeInTheDocument();
    expect(routerMocks.push).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("login page demo hint", () => {
  it("shows the muted demo hint line under the form", () => {
    render(<LoginPage />);
    expect(
      screen.getByText("Demo: demo / demo-pass-123"),
    ).toBeInTheDocument();
  });
});

describe("logout()", () => {
  it("POSTs /api/auth/logout then navigates to /login", async () => {
    stubFetch(200, { ok: true });
    const navigate = vi.fn();

    await logout(navigate);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/logout",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
    expect(navigate).toHaveBeenCalledWith("/login");
  });

  it("still navigates to /login when the POST fails (best-effort)", async () => {
    stubFetch(500, { detail: "boom" });
    const navigate = vi.fn();

    await logout(navigate);

    expect(navigate).toHaveBeenCalledWith("/login");
  });
});
