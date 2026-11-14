import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import EmptyState from "../components/EmptyState";

describe("EmptyState hint (P1)", () => {
  it("shows the coverage hint when provided", () => {
    render(<EmptyState onSuggest={() => {}} hint="Nothing indexed in this area" />);
    expect(screen.getByTestId("empty-hint")).toHaveTextContent("Nothing indexed in this area");
  });
  it("renders plain suggestions without a hint by default", () => {
    render(<EmptyState onSuggest={() => {}} />);
    expect(screen.queryByTestId("empty-hint")).not.toBeInTheDocument();
  });
});
