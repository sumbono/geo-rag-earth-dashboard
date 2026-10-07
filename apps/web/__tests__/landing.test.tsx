import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Page from "../app/page";

describe("landing page", () => {
  it("renders the headline", () => {
    render(<Page />);
    expect(
      screen.getByRole("heading", { name: "Geo-RAG Earth Dashboard" }),
    ).toBeInTheDocument();
  });

  it("links to the login page", () => {
    render(<Page />);
    const links = screen.getAllByRole("link");
    expect(links.some((a) => a.getAttribute("href") === "/login")).toBe(true);
  });

  it("renders both preview slots", () => {
    render(<Page />);
    expect(screen.getByTestId("screenshot-slot")).toBeInTheDocument();
    expect(screen.getByTestId("gif-slot")).toBeInTheDocument();
  });

  it("fills both slots with the real screenshot and GIF", () => {
    render(<Page />);
    expect(
      within(screen.getByTestId("screenshot-slot")).getByRole("img"),
    ).toHaveAttribute("src", "/screenshots/dashboard-with-results.png");
    expect(within(screen.getByTestId("gif-slot")).getByRole("img")).toHaveAttribute(
      "src",
      "/demo.gif",
    );
  });
});
