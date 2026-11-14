import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
}));

import AppHeader from "../components/AppHeader";

describe("AppHeader (P0 chrome)", () => {
  beforeEach(() => replace.mockClear());

  it("renders wordmark link home, GitHub link, and logout button", () => {
    render(<AppHeader />);
    expect(screen.getByRole("link", { name: /geo-rag earth dashboard/i })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/sumbono/geo-rag-earth-dashboard",
    );
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
  });

  it("POSTs /api/auth/logout then routes to /login", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    render(<AppHeader />);
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/auth/logout",
        expect.objectContaining({ method: "POST", credentials: "include" }),
      ),
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
    vi.unstubAllGlobals();
  });

  it("still routes to /login when the logout POST fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    render(<AppHeader />);
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
    vi.unstubAllGlobals();
  });
});
