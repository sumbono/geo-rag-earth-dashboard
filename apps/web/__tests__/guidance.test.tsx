// apps/web/__tests__/guidance.test.tsx
// vitest has NO globals:true — every file imports its own bindings (repo convention).
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FirstRunGuide from "../components/FirstRunGuide";
import DashboardPage from "../app/dashboard/page";
import type { SearchResult } from "../lib/types";

// maplibre-gl needs WebGL → mocked wholesale (same boilerplate as search_ui.test.tsx)
const hoisted = vi.hoisted(() => {
  const mapInstances: any[] = [];
  class MockMap {
    options: any;
    setData = vi.fn();
    on = vi.fn();
    once = vi.fn();
    remove = vi.fn();
    isStyleLoaded = vi.fn(() => true);
    getSource = vi.fn((id?: string) => (id === "results" ? { setData: this.setData } : undefined));
    setLayoutProperty = vi.fn();
    setPaintProperty = vi.fn();
    getSourceRange = undefined;
    queryRenderedFeatures = vi.fn(() => []);
    setLayoutProperty2 = undefined;
    flyTo = vi.fn();
    constructor(options: any) {
      this.options = options;
      mapInstances.push(this);
    }
  }
  class MockPopup {
    setLngLat = vi.fn((): any => this);
    setHTML = vi.fn((): any => this);
    setDOMContent = vi.fn((): any => this);
    addTo = vi.fn((): any => this);
    remove = vi.fn();
  }
  return { MockMap, MockPopup, mapInstances };
});
vi.mock("maplibre-gl", () => ({
  default: { Map: hoisted.MockMap, Popup: hoisted.MockPopup },
  Map: hoisted.MockMap,
  Popup: hoisted.MockPopup,
  setWorkerUrl: vi.fn(),
  Marker: vi.fn(() => ({ setLngLat: vi.fn().mockReturnThis(), addTo: vi.fn().mockReturnThis(), remove: vi.fn(), setPopup: vi.fn().mockReturnThis() })),
  LngLatBounds: vi.fn(),
}));

// fetch harness (api.test.ts convention): stub globally, restore per test
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ results: [] }), { status: 200, headers: { "Content-Type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const ONE_RESULT: SearchResult = {
  id: "11111111-1111-1111-1111-111111111111",
  thumb_url: "/api/thumbs/11111111-1111-1111-1111-111111111111",
  bbox: [[[39, 21], [39.1, 21], [39.1, 21.1], [39, 21.1], [39, 21]]],
  score: 0.91,
  captured_at: "2025-09-29T08:04:26Z",
};

describe("FirstRunGuide", () => {
  it("renders the how-it-works steps and the value explainer when visible", () => {
    render(<FirstRunGuide visible onSuggest={() => {}} />);
    expect(screen.getByRole("heading", { name: /how this works/i })).toBeInTheDocument();
    // RTL getByText matches direct text nodes — pin through the <li> wrapper:
    expect(screen.getByText(/score/i).closest("li")).toHaveTextContent(/0\.00/);
    expect(screen.getByText(/capture date/i).closest("li")).toBeInTheDocument();
  });

  it("renders nothing when not visible", () => {
    render(<FirstRunGuide visible={false} onSuggest={() => {}} />);
    expect(screen.queryByRole("heading", { name: /how this works/i })).not.toBeInTheDocument();
  });

  it("suggestion buttons call onSuggest with the query text", () => {
    const onSuggest = vi.fn();
    render(<FirstRunGuide visible onSuggest={onSuggest} />);
    fireEvent.click(screen.getByRole("button", { name: "turquoise coastal water" }));
    expect(onSuggest).toHaveBeenCalledWith("turquoise coastal water");
  });
});

describe("dashboard first run", () => {
  it("shows the guide before the first search, hides it once results exist", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ results: [ONE_RESULT] }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    render(<DashboardPage />);
    expect(screen.getByRole("heading", { name: /how this works/i })).toBeInTheDocument();
    expect(screen.queryByText("No results")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: /search/i }), { target: { value: "water" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("0.91")).toBeInTheDocument();  // result row (testid exists only from Task 5)
    expect(screen.queryByRole("heading", { name: /how this works/i })).not.toBeInTheDocument();
  });

  it("shows the guide again on a fresh mount with no prior search", () => {
    const { unmount } = render(<DashboardPage />);
    unmount();
    render(<DashboardPage />);
    expect(screen.getByRole("heading", { name: /how this works/i })).toBeInTheDocument();
  });
});
