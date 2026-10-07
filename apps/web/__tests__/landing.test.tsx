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

  it("renders the preview slot with the walkthrough GIF (no static screenshot slot)", () => {
    render(<Page />);
    expect(screen.getByTestId("gif-slot")).toBeInTheDocument();
    expect(screen.queryByTestId("screenshot-slot")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("gif-slot")).getByRole("img")).toHaveAttribute(
      "src",
      "/demo.gif",
    );
  });

  it("links to the GitHub repository in the header", () => {
    render(<Page />);
    const link = screen.getByRole("link", {
      name: /github repository/i,
    });
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/sumbono/geo-rag-earth-dashboard",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener");
  });

  it("renders the demo access card with the public sandbox credentials", () => {
    render(<Page />);
    const card = screen.getByTestId("demo-access-card");
    expect(card).toHaveTextContent(/public sandbox with sample data/i);
    expect(card).toHaveTextContent("demo");
    expect(card).toHaveTextContent("demo-pass-123");
  });
});
