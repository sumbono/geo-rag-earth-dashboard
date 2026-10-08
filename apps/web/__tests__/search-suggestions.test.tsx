import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import SearchBar from "../components/SearchBar";

const base = {
  query: "",
  onQueryChange: () => {},
  onSearchStart: () => {},
  onResults: () => {},
  onError: () => {},
};

it("renders all three example chips without any prior search", () => {
  render(<SearchBar {...base} onSuggest={() => {}} />);
  for (const name of ["turquoise coastal water", "desert near shoreline", "cloud patterns"]) {
    expect(screen.getByRole("button", { name })).toBeInTheDocument();
  }
});

it("clicking a chip calls onSuggest exactly once", () => {
  const onSuggest = vi.fn();
  render(<SearchBar {...base} onSuggest={onSuggest} />);
  fireEvent.click(screen.getByRole("button", { name: "cloud patterns" }));
  expect(onSuggest).toHaveBeenCalledTimes(1);
  expect(onSuggest).toHaveBeenCalledWith("cloud patterns");
});
