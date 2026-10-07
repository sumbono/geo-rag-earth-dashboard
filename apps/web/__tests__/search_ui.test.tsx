/**
 * Task 17 — dashboard search + map + results UI.
 *
 * maplibre-gl needs WebGL, so it is mocked wholesale; the Map component
 * itself is wrapped (not replaced) so the real component runs against the
 * mock and every `results` prop it receives is recorded for assertions.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DashboardPage from "../app/dashboard/page";
import type { SearchResult } from "../lib/types";

type MapProps = { results: SearchResult[]; onPick: (id: string) => void };

const hoisted = vi.hoisted(() => {
  const mapInstances: any[] = [];
  const popups: any[] = [];

  class MockPopup {
    constructor() {
      popups.push(this);
    }
    setLngLat = vi.fn((): any => this);
    setHTML = vi.fn((): any => this);
    addTo = vi.fn((): any => this);
  }

  class MockMap {
    options: any;
    setData = vi.fn();
    on = vi.fn();
    once = vi.fn();
    remove = vi.fn();
    isStyleLoaded = vi.fn(() => true);
    getSource = vi.fn((id?: string) =>
      id === "results" ? { setData: this.setData } : undefined,
    );
    setLayoutProperty = vi.fn();
    flyTo = vi.fn();

    constructor(options: any) {
      this.options = options;
      mapInstances.push(this);
    }
  }

  return {
    MockMap,
    MockPopup,
    mapInstances,
    popups,
    mapProps: null as MapProps | null,
  };
});

vi.mock("maplibre-gl", () => ({
  default: { Map: hoisted.MockMap, Popup: hoisted.MockPopup },
  Map: hoisted.MockMap,
  Popup: hoisted.MockPopup,
}));

// Spy on the Map component's props while still rendering the real one.
vi.mock("../components/Map", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../components/Map")>();
  const ActualMap = actual.default;
  function MapSpy(props: MapProps) {
    hoisted.mapProps = props;
    return <ActualMap {...props} />;
  }
  return { default: MapSpy };
});

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
    score: 0.87654,
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
    score: 0.4321,
    captured_at: "2023-11-20T08:00:00Z",
  },
];

function submitQuery(query: string) {
  fireEvent.change(screen.getByLabelText("Search"), {
    target: { value: query },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
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
  hoisted.mapProps = null;
  hoisted.mapInstances.length = 0;
  hoisted.popups.length = 0;
});

describe("dashboard search UI", () => {
  it("POSTs the query once to /api/search/vector and renders scores + dates", async () => {
    stubFetch(200, { results: sampleResults });
    render(<DashboardPage />);

    submitQuery("water");

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/search/vector");
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("include");
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
    expect(JSON.parse(String(init?.body))).toEqual({ query: "water" });

    expect(await screen.findByText("0.88")).toBeInTheDocument();
    expect(screen.getByText("0.43")).toBeInTheDocument();
    expect(screen.getByText("2024-05-01")).toBeInTheDocument();
    expect(screen.getByText("2023-11-20")).toBeInTheDocument();

    // The map mock receives the lifted results.
    expect(hoisted.mapProps?.results).toEqual(sampleResults);
  });

  it("surfaces ApiError messages from a failed search", async () => {
    stubFetch(401, { detail: "Could not validate credentials" });
    render(<DashboardPage />);

    submitQuery("water");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not validate credentials",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("replaces the plain placeholder with the designed empty state after a search", async () => {
    stubFetch(200, { results: [] });
    render(<DashboardPage />);

    // First visit — nothing yet, not even the empty state (Task 18 gate).
    expect(screen.queryByText("No results")).not.toBeInTheDocument();

    submitQuery("water");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByRole("button", { name: "turquoise coastal water" }),
    ).toBeInTheDocument();
  });
});

describe("map", () => {
  it("initializes Esri imagery + hidden OSM, marks results, flies to the first", async () => {
    stubFetch(200, { results: sampleResults });
    render(<DashboardPage />);

    expect(hoisted.mapInstances).toHaveLength(1);
    const map = hoisted.mapInstances[0];
    const style = map.options.style;

    expect(map.options.center).toEqual([39, 22]);
    expect(map.options.zoom).toBe(6);
    expect(style.sources.esri.tiles[0]).toBe(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    );
    expect(style.sources.esri.attribution).toBe("Esri");
    expect(style.sources.osm).toBeDefined();
    const osmLayer = style.layers.find((l: any) => l.id === "osm-streets");
    expect(osmLayer.layout.visibility).toBe("none");

    submitQuery("water");
    await waitFor(() =>
      expect(hoisted.mapProps?.results).toEqual(sampleResults),
    );

    // Markers: one point per result, colored off the score property.
    const fc = map.setData.mock.calls.at(-1)[0];
    expect(fc.type).toBe("FeatureCollection");
    expect(
      fc.features.map((f: any) => f.properties.id),
    ).toEqual(["tile-1", "tile-2"]);
    expect(fc.features[0].properties.score).toBe(0.87654);
    const markersLayer = style.layers.find(
      (l: any) => l.id === "result-markers",
    );
    expect(JSON.stringify(markersLayer.paint["circle-color"])).toContain(
      "score",
    );

    // Fly to the first result's bbox centroid (ring 0 average).
    expect(map.flyTo).toHaveBeenCalledTimes(1);
    const fly = map.flyTo.mock.calls[0][0];
    expect(fly.center[0]).toBeCloseTo(38.05, 5);
    expect(fly.center[1]).toBeCloseTo(21.05, 5);
  });

  it("flips the OSM streets layer visibility from its toggle button", () => {
    render(<DashboardPage />);
    const map = hoisted.mapInstances[0];
    const toggle = screen.getByRole("button", { name: "OSM streets" });

    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(map.setLayoutProperty).toHaveBeenCalledWith(
      "osm-streets",
      "visibility",
      "visible",
    );
    expect(toggle).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(toggle);
    expect(map.setLayoutProperty).toHaveBeenCalledWith(
      "osm-streets",
      "visibility",
      "none",
    );
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  it("removes the map instance on unmount", () => {
    const { unmount } = render(<DashboardPage />);
    const map = hoisted.mapInstances[0];

    unmount();

    expect(map.remove).toHaveBeenCalledTimes(1);
  });

  it("opens a score/date popup on marker click and selects the row", async () => {
    stubFetch(200, { results: sampleResults });
    render(<DashboardPage />);
    submitQuery("water");
    expect(await screen.findByText("0.88")).toBeInTheDocument();

    const map = hoisted.mapInstances[0];
    const clickCall = map.on.mock.calls.find(
      (call: any[]) => call[0] === "click" && call[1] === "result-markers",
    );
    expect(clickCall).toBeTruthy();

    act(() => {
      clickCall[2]({
        features: [
          {
            properties: {
              id: "tile-1",
              score_display: "0.88",
              date: "2024-05-01",
              lng: 38.05,
              lat: 21.05,
            },
          },
        ],
      });
    });

    const popup = hoisted.popups.at(-1);
    expect(popup.setLngLat).toHaveBeenCalledWith([38.05, 21.05]);
    const html = popup.setHTML.mock.calls[0][0] as string;
    expect(html).toContain("0.88");
    expect(html).toContain("2024-05-01");
    expect(popup.addTo).toHaveBeenCalledWith(map);

    expect(
      screen.getByRole("button", { name: /0\.88/ }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});
