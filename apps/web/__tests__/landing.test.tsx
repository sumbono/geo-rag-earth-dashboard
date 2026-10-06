import { render, screen } from "@testing-library/react";
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

  it("provides placeholder slots for the Task 24 screenshots/GIF", () => {
    render(<Page />);
    expect(screen.getByTestId("screenshot-slot")).toBeInTheDocument();
    expect(screen.getByTestId("gif-slot")).toBeInTheDocument();
  });
});
