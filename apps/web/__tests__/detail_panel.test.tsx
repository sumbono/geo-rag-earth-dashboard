/**
 * Task 18 — detail panel, D3 score chart, empty-state suggestions.
 *
 * maplibre-gl needs WebGL, so it is mocked wholesale (same approach as
 * search_ui.test.tsx) — the dashboard page under test renders the real Map
 * component against the mock.
 */
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DashboardPage from "../app/dashboard/page";
import DetailPanel from "../components/DetailPanel";
import ScoreBarChart from "../components/ScoreBarChart";
import type { SearchResult } from "../lib/types";

const hoisted = vi.hoisted(() => {
  class MockPopup {
    setLngLat = vi.fn((): any => this);
    setHTML = vi.fn((): any => this);
    setDOMContent = vi.fn((): any => this);
    addTo = vi.fn((): any => this);
    remove = vi.fn();
  }

  class MockMap {
    options: any;
    setData = vi.fn();
    on = vi.fn();
    once = vi.fn();
    remove = vi.fn();
    isStyleLoaded = vi.fn(() => true);
    getSource = vi.fn(() => ({ setData: vi.fn() }));
    setLayoutProperty = vi.fn();
    flyTo = vi.fn();

    constructor(options: any) {
      this.options = options;
    }
  }

  return { MockMap, MockPopup };
});

vi.mock("maplibre-gl", () => ({
  default: { Map: hoisted.MockMap, Popup: hoisted.MockPopup },
  Map: hoisted.MockMap,
  Popup: hoisted.MockPopup,
  setWorkerUrl: vi.fn(), // R13(b): Map.tsx pins the worker URL at import time
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

function submitQuery(query: string) {
  fireEvent.change(screen.getByLabelText("Search"), {
    target: { value: query },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
}

const sampleResults: SearchResult[] = [
  {
    id: "tile-1",
    thumb_url: "/api/thumbs/tile-1",
    bbox: [
      [
        [38, 21],
        [38.1, 21],
        [38.1, 21.1],
        [38, 21.1],
        [38, 21],
      ],
    ],
    score: 0.9,
    captured_at: "2024-05-01T12:34:56Z",
  },
  {
    id: "tile-2",
    thumb_url: "/api/thumbs/tile-2",
    bbox: [
      [
        [40, 23],
        [40.2, 23],
        [40.2, 23.2],
        [40, 23.2],
        [40, 23],
      ],
    ],
    score: 0.6,
    captured_at: "2023-11-20T08:00:00Z",
  },
  {
    id: "tile-3",
    thumb_url: "/api/thumbs/tile-3",
    bbox: [
      [
        [-12.5, 35.5],
        [-12.4, 35.5],
        [-12.4, 35.6],
        [-12.5, 35.6],
        [-12.5, 35.5],
      ],
    ],
    score: 0.25,
    captured_at: "2022-07-09T03:15:00Z",
  },
];

let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  const errors = consoleError.mock.calls.map((args: unknown[]) => String(args[0]));
  const warns = consoleWarn.mock.calls.map((args: unknown[]) => String(args[0]));
  consoleError.mockRestore();
  consoleWarn.mockRestore();
  expect(errors).toEqual([]);
  expect(warns).toEqual([]);

  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("ScoreBarChart", () => {
  it("renders one bar per result, scales widths to score, highlights the selection", () => {
    const { container } = render(
      <ScoreBarChart results={sampleResults} selectedId="tile-2" />,
    );

    const bars = container.querySelectorAll("rect");
    expect(bars).toHaveLength(3);
    expect(bars[0]).toHaveClass("score-bar");
    expect(bars[1]).toHaveClass("score-bar", "score-bar--selected");
    expect(bars[0]).not.toHaveClass("score-bar--selected");
    expect(bars[2]).not.toHaveClass("score-bar--selected");

    // x = score over the [0, 1] domain: widths track scores proportionally.
    const width = (i: number) => Number(bars[i].getAttribute("width"));
    expect(width(0) / width(1)).toBeCloseTo(0.9 / 0.6, 1);
    expect(width(1) / width(2)).toBeCloseTo(0.6 / 0.25, 1);

    // Score labels for every bar.
    expect(screen.getByText("0.90")).toBeInTheDocument();
    expect(screen.getByText("0.60")).toBeInTheDocument();
    expect(screen.getByText("0.25")).toBeInTheDocument();
  });
});

describe("DetailPanel", () => {
  it("shows thumb, bbox, captured_at, embedded chart and closes on demand", () => {
    const onClose = vi.fn();
    const { container } = render(
      <DetailPanel
        tile={sampleResults[0]}
        results={sampleResults}
        onClose={onClose}
      />,
    );

    expect(screen.getByAltText(/tile-1/)).toHaveAttribute(
      "src",
      "/api/thumbs/tile-1",
    );
    expect(screen.getByText("2024-05-01T12:34:56Z")).toBeInTheDocument();
    expect(screen.getByText(/38\.0000,\s*21\.0000/)).toBeInTheDocument();

    // Embedded chart: all results, the viewed tile selected.
    const bars = container.querySelectorAll("rect");
    expect(bars).toHaveLength(3);
    expect(bars[0]).toHaveClass("score-bar--selected");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("toggles the thumbnail between true color and false color", () => {
    render(<DetailPanel tile={sampleResults[0]} onClose={vi.fn()} />);

    const thumb = screen.getByAltText(/tile-1/);
    expect(thumb).toHaveAttribute("src", "/api/thumbs/tile-1");

    fireEvent.click(screen.getByRole("button", { name: "False color" }));
    expect(thumb).toHaveAttribute("src", "/api/thumbs/tile-1?fc=1");

    fireEvent.click(screen.getByRole("button", { name: "True color" }));
    expect(thumb).toHaveAttribute("src", "/api/thumbs/tile-1");
  });
});

describe("empty state", () => {
  it("stays hidden on first visit and shows the three suggestions after a search", async () => {
    stubFetch(200, { results: [] });
    render(<DashboardPage />);

    // First visit: no search has run, so no empty state (guide chips may show).
    expect(screen.queryByText("No results")).not.toBeInTheDocument();

    submitQuery("water");

    // Scope to the empty-state region: the SearchBar renders the same
    // example chips unconditionally, so the page has two of each name.
    const empty = () =>
      within(screen.getByRole("region", { name: "No results" }));
    expect(
      await empty().findByRole("button", { name: "turquoise coastal water" }),
    ).toBeInTheDocument();
    expect(
      empty().getByRole("button", { name: "desert near shoreline" }),
    ).toBeInTheDocument();
    expect(
      empty().getByRole("button", { name: "cloud patterns" }),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("runs exactly one more search POST when a suggestion is clicked", async () => {
    stubFetch(200, { results: [] });
    render(<DashboardPage />);

    submitQuery("water");
    // Two buttons carry this name (SearchBar chip + EmptyState copy), so
    // pin the click to the suggestion inside the no-results region.
    const suggestion = await within(
      screen.getByRole("region", { name: "No results" }),
    ).findByRole("button", { name: "cloud patterns" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(suggestion);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("/api/search/vector");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      query: "cloud patterns",
    });
  });

  it("puts the clicked suggestion into the search input", async () => {
    stubFetch(200, { results: [] });
    render(<DashboardPage />);

    submitQuery("water");
    // Scope to the empty-state region — the SearchBar chip shares the name.
    const suggestion = await within(
      screen.getByRole("region", { name: "No results" }),
    ).findByRole("button", { name: "turquoise coastal water" });
    fireEvent.click(suggestion);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    // The input reflects the active query, so a follow-up manual submit
    // re-runs what the user just saw — not the previous stale text.
    expect(screen.getByLabelText("Search")).toHaveValue(
      "turquoise coastal water",
    );
  });
});

describe("dashboard wiring", () => {
  it("opens the detail panel on row pick and closes it again", async () => {
    stubFetch(200, { results: sampleResults });
    render(<DashboardPage />);

    submitQuery("water");
    const row = await screen.findByRole("button", { name: /0\.90/ });
    fireEvent.click(row);

    const thumb = await screen.findByAltText(/tile-1/);
    expect(thumb).toHaveAttribute("src", "/api/thumbs/tile-1");
    expect(screen.getByText("2024-05-01T12:34:56Z")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() =>
      expect(screen.queryByAltText(/tile-1/)).not.toBeInTheDocument(),
    );
  });
});
