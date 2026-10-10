/**
 * Task 19 — two-click bbox draw search.
 *
 * maplibre-gl needs WebGL, so it is mocked wholesale; the Map component is
 * wrapped (not replaced) so the real component runs against the mock, its
 * ref stays attached, and simulated map clicks invoke the handler the real
 * Map registered on the mock instance (the plain `click` listener, not the
 * marker-layer one).
 */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DashboardPage from "../app/dashboard/page";
import type { SearchResult } from "../lib/types";

const hoisted = vi.hoisted(() => {
  const mapInstances: any[] = [];

  class MockPopup {
    setLngLat = vi.fn((): any => this);
    setHTML = vi.fn((): any => this);
    setDOMContent = vi.fn((): any => this);
    addTo = vi.fn((): any => this);
    remove = vi.fn();
  }

  class MockMap {
    options: any;
    resultsData = vi.fn();
    rectangleData = vi.fn();
    on = vi.fn();
    once = vi.fn();
    remove = vi.fn();
    isStyleLoaded = vi.fn(() => true);
    getSource = vi.fn((id?: string) => {
      if (id === "results") return { setData: this.resultsData };
      if (id === "rectangle") return { setData: this.rectangleData };
      return undefined;
    });
    setLayoutProperty = vi.fn();
    flyTo = vi.fn();

    constructor(options: any) {
      this.options = options;
      mapInstances.push(this);
    }
  }

  return { MockMap, MockPopup, mapInstances };
});

vi.mock("maplibre-gl", () => ({
  default: { Map: hoisted.MockMap, Popup: hoisted.MockPopup },
  Map: hoisted.MockMap,
  Popup: hoisted.MockPopup,
  setWorkerUrl: vi.fn(), // R13(b): Map.tsx pins the worker URL at import time
}));

// Spy on the Map component's props/ref while still rendering the real one.
vi.mock("../components/Map", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../components/Map")>();
  const ActualMap = actual.default;
  function MapSpy(props: any) {
    const { ref, ...rest } = props;
    return <ActualMap {...rest} ref={ref} />;
  }
  return { default: MapSpy };
});

const fetchMock = vi.fn<typeof fetch>();

/** Route stub: any URL without an entry answers 500, so stray calls fail loudly. */
function stubFetch(routes: Record<string, unknown>) {
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (!(url in routes)) {
      return new Response(JSON.stringify({ detail: `unexpected ${url}` }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify(routes[url]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
}

function tile(id: string, score: number, capturedAt: string): SearchResult {
  return {
    id,
    thumb_url: `/api/thumbs/${id}`,
    bbox: [
      [
        [38, 21],
        [38.1, 21],
        [38.1, 21.1],
        [38, 21.1],
        [38, 21],
      ],
    ],
    score,
    captured_at: capturedAt,
  };
}

// Vector-mode hits (cosine scores) — the panel before any drawing.
const vectorResults: SearchResult[] = [
  tile("tile-1", 0.87654, "2024-05-01T12:34:56Z"),
  tile("tile-2", 0.4321, "2023-11-20T08:00:00Z"),
];

// Bbox-mode hits: tile-2 again (higher score must win), tile-3 is new.
const bboxResults: SearchResult[] = [
  tile("tile-2", 0.95, "2023-11-20T08:00:00Z"),
  tile("tile-3", 0.5, "2024-03-10T09:00:00Z"),
];

// No-q spatial hit: backend scores everything 0.0 (captured_at DESC).
const spatialOnly: SearchResult[] = [
  tile("tile-9", 0, "2024-06-15T10:00:00Z"),
];

/** Fire the plain map `click` listener the real Map registered (draw-mode feed). */
function drawClick(lng: number, lat: number) {
  const map = hoisted.mapInstances[0];
  const call = map.on.mock.calls.find(
    (entry: any[]) => entry[0] === "click" && typeof entry[1] === "function",
  );
  expect(call).toBeTruthy();
  act(() => {
    call[1]({ lngLat: { lng, lat } });
  });
}

function toggleDraw() {
  fireEvent.click(screen.getByRole("button", { name: "Draw area" }));
}

function submitQuery(query: string) {
  fireEvent.change(screen.getByLabelText("Search"), {
    target: { value: query },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
}

function bboxCalls() {
  return fetchMock.mock.calls.filter((call) => String(call[0]) === "/api/search/bbox");
}

let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  // Collect before restoring so a failure still cleans up the spies.
  const errors = consoleError.mock.calls.map((args: unknown[]) => String(args[0]));
  const warns = consoleWarn.mock.calls.map((args: unknown[]) => String(args[0]));
  consoleError.mockRestore();
  consoleWarn.mockRestore();
  expect(errors).toEqual([]);
  expect(warns).toEqual([]);

  vi.unstubAllGlobals();
  fetchMock.mockReset();
  hoisted.mapInstances.length = 0;
});

describe("bbox draw search", () => {
  it("runs exactly one ordered bbox request after two clicks and draws the rectangle", async () => {
    stubFetch({ "/api/search/bbox": { results: spatialOnly } });
    render(<DashboardPage />);

    const toggle = screen.getByRole("button", { name: "Draw area" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    toggleDraw();
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Click the map to set corner A/)).toBeInTheDocument();

    // First click — corner A only: temp visual, no request yet.
    drawClick(40, 23);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText(/Corner A: 40\.0000, 23\.0000/)).toBeInTheDocument();

    // Second click, both axes reversed → normalized [[w,s],[e,n]].
    drawClick(38, 21);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/search/bbox");
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("include");
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );

    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({ bbox: [[38, 21], [40, 23]], q: null });
    const [[w, s], [e, n]] = body.bbox as [[number, number], [number, number]];
    expect(w).toBeLessThan(e);
    expect(s).toBeLessThan(n);

    // Exactly one bbox request for the whole flow.
    expect(bboxCalls()).toHaveLength(1);

    // Rectangle rendered on the map from the same ordered bbox.
    const map = hoisted.mapInstances[0];
    const fc = map.rectangleData.mock.calls.at(-1)[0];
    expect(fc.features[0].geometry.coordinates[0]).toEqual([
      [38, 21],
      [40, 21],
      [40, 23],
      [38, 23],
      [38, 21],
    ]);

    // Panel shows the spatial hits (no prior results → union is just these).
    expect(await screen.findByText("0.00")).toBeInTheDocument();
    expect(screen.getByText("2024-06-15")).toBeInTheDocument();

    // Drawing complete → the toggle disarms.
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  it("merges bbox hits into the panel by union with max score and passes the last query", async () => {
    stubFetch({
      "/api/search/vector": { results: vectorResults },
      "/api/search/bbox": { results: bboxResults },
    });
    render(<DashboardPage />);

    submitQuery("water");
    expect(await screen.findByText("0.88")).toBeInTheDocument();

    toggleDraw();
    drawClick(40, 23);
    drawClick(38, 21);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(bboxCalls()).toHaveLength(1);
    const [, init] = bboxCalls()[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      bbox: [[38, 21], [40, 23]],
      q: "water",
    });

    // Union: tile-1 kept (absent from bbox), tile-2 shared → higher score
    // wins, tile-3 appended. Exactly 3 rows, vector order preserved.
    expect(await screen.findByText("0.95")).toBeInTheDocument();
    expect(screen.getByText("0.88")).toBeInTheDocument();
    expect(screen.getByText("0.50")).toBeInTheDocument();
    expect(screen.queryByText("0.43")).not.toBeInTheDocument();

    const rows = within(
      screen.getByRole("list", { name: "Search results" }),
    ).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("0.88");
    expect(rows[1]).toHaveTextContent("0.95");
    expect(rows[2]).toHaveTextContent("0.50");
  });

  it("cancels on Esc mid-draw: no request, temp visual cleared, next click restarts", () => {
    stubFetch({});
    render(<DashboardPage />);

    toggleDraw();
    drawClick(39, 22);
    expect(screen.getByText(/Corner A: 39\.0000, 22\.0000/)).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByText(/Corner A:/)).not.toBeInTheDocument();
    expect(screen.getByText(/Click the map to set corner A/)).toBeInTheDocument();
    // Esc aborts the rectangle only — the tool stays armed.
    expect(
      screen.getByRole("button", { name: "Draw area" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(fetchMock).not.toHaveBeenCalled();

    // The next click starts a fresh session instead of completing the old one.
    drawClick(41, 25);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText(/Corner A: 41\.0000, 25\.0000/)).toBeInTheDocument();
  });

  it("resets the pending corner when the toggle turns draw mode off and on", () => {
    stubFetch({});
    render(<DashboardPage />);

    toggleDraw();
    drawClick(10, 20);
    expect(screen.getByText(/Corner A: 10\.0000, 20\.0000/)).toBeInTheDocument();

    // Disarm mid-draw → temp visual cleared.
    toggleDraw();
    expect(
      screen.getByRole("button", { name: "Draw area" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText(/Corner A:/)).not.toBeInTheDocument();

    // Re-arm → first click must be corner A again, never a stale completion.
    toggleDraw();
    drawClick(12, 22);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText(/Corner A: 12\.0000, 22\.0000/)).toBeInTheDocument();
  });

  it("clears the previous rectangle when draw mode is re-armed", async () => {
    stubFetch({ "/api/search/bbox": { results: spatialOnly } });
    render(<DashboardPage />);

    toggleDraw();
    drawClick(40, 23);
    drawClick(38, 21);
    await waitFor(() => expect(bboxCalls()).toHaveLength(1));
    await screen.findByText("2024-06-15");

    const map = hoisted.mapInstances[0];
    expect(map.rectangleData).toHaveBeenCalledTimes(2); // clear on arm + render

    toggleDraw(); // arm again → the stale box is cleared
    const last = map.rectangleData.mock.calls.at(-1)[0];
    expect(last.features).toEqual([]);
  });

  it("ships a dashed draw-preview line layer plus the R-6a corner-A dot circle layer", () => {
    stubFetch({});
    render(<DashboardPage />);

    // The Map mock hands the raw style through, so the layer set is observable.
    const style = hoisted.mapInstances[0].options.style;
    const line = style.layers.find((l: any) => l.id === "draw-preview");
    expect(line).toMatchObject({
      type: "line",
      source: "preview",
      paint: { "line-color": "#0b6f8f", "line-dasharray": [2, 2] },
      // Only polygons: a Point on a line layer would draw nothing anyway,
      // but the explicit filter keeps the two preview layers disjoint.
      filter: ["!=", ["geometry-type"], "Point"],
    });
    const dot = style.layers.find((l: any) => l.id === "draw-preview-dot");
    expect(dot).toMatchObject({
      type: "circle",
      source: "preview",
      // Circle buckets paint EVERY vertex of every feature they receive
      // (maplibre CircleBucket.addFeature), so the dot layer must be filtered
      // to Point features or the completed box would bloom with corner dots.
      filter: ["==", ["geometry-type"], "Point"],
      paint: { "circle-radius": 5, "circle-color": "#0b6f8f", "circle-opacity": 0.9 },
    });
    // Distinct from the persisted layer, and its source starts empty.
    expect(style.layers.some((l: any) => l.id === "draw-rectangle")).toBe(true);
    expect(style.sources.preview.data.features).toEqual([]);
  });

  it("shows the empty state when a bbox search returns nothing", async () => {
    stubFetch({ "/api/search/bbox": { results: [] } });
    render(<DashboardPage />);

    // First visit gate: nothing until a search has run.
    expect(screen.queryByText("No results")).not.toBeInTheDocument();

    toggleDraw();
    drawClick(40, 23);
    drawClick(38, 21);

    // The first-run guide renders the same chip before any search, so wait
    // for the empty-state region first, then pin the chip inside it.
    const emptyState = await screen.findByRole("region", { name: "No results" });
    expect(
      within(emptyState).getByRole("button", { name: "turquoise coastal water" }),
    ).toBeInTheDocument();
  });

  it("keeps an open detail panel through the bbox merge", async () => {
    stubFetch({
      "/api/search/vector": { results: vectorResults },
      "/api/search/bbox": { results: bboxResults },
    });
    render(<DashboardPage />);

    submitQuery("water");
    expect(await screen.findByText("0.88")).toBeInTheDocument();
    // Pick tile-1 (vector-only) → detail panel opens.
    fireEvent.click(screen.getByText("0.88"));
    expect(
      await screen.findByRole("region", { name: "Tile details" }),
    ).toBeInTheDocument();

    toggleDraw();
    drawClick(40, 23);
    drawClick(38, 21);
    await waitFor(() => expect(bboxCalls()).toHaveLength(1));

    // tile-1 survives the union, so the selection — and panel — survive too.
    // (Scope to the results list: the detail chart labels scores too.)
    const list = screen.getByRole("list", { name: "Search results" });
    await waitFor(() =>
      expect(within(list).getByText("0.95")).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("region", { name: "Tile details" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("surfaces a failed bbox request as the page alert", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ detail: "bbox search failed" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<DashboardPage />);

    toggleDraw();
    drawClick(40, 23);
    drawClick(38, 21);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "bbox search failed",
    );
    // Visual-first (Task 6, finding 8): the rectangle is handed to the map
    // at corner B BEFORE the request leaves, so on failure the drawn box
    // STAYS — the user sees what they drew and the alert explains the error.
    // (Pre-Task-6 this asserted no rectangle; the disarm + single-error
    // intent of the test is unchanged.)
    const map = hoisted.mapInstances[0];
    expect(map.rectangleData.mock.calls.at(-1)[0].features[0].geometry.coordinates[0]).toEqual([
      [38, 21],
      [40, 21],
      [40, 23],
      [38, 23],
      [38, 21],
    ]);
    expect(
      screen.getByRole("button", { name: "Draw area" }),
    ).toHaveAttribute("aria-pressed", "false");
  });
});
