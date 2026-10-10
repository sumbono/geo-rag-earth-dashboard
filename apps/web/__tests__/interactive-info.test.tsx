/**
 * Task 9 — interactive info display: row → map/3D cross-highlight wiring,
 * detail prev/next (buttons + window arrow keys), and the single DOM-built
 * popup lifecycle (close-before-reopen, remove on unmount — audit major #6).
 *
 * maplibre-gl needs WebGL, so it is mocked wholesale (same pattern as
 * search_ui.test.tsx) and the Map component is spied (wrapped, not replaced)
 * so props like `hoveredId` are observable while the real component runs
 * against the mock. The MockPopup class carries `setDOMContent` + `remove`
 * (finding 23) so per-instance call counts can pin the lifecycle.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DashboardPage from "../app/dashboard/page";
import DetailPanel from "../components/DetailPanel";
import MapView from "../components/Map";
import ResultsPanel from "../components/ResultsPanel";
import type { SearchResult } from "../lib/types";

type MapProps = {
  results: SearchResult[];
  onPick: (id: string) => void;
  hoveredId?: string | null;
};

const hoisted = vi.hoisted(() => {
  const mapInstances: any[] = [];
  const popups: any[] = [];

  class MockPopup {
    constructor() {
      popups.push(this);
    }
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
  setWorkerUrl: vi.fn(), // Map.tsx pins the worker URL at import time
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

function submitQuery(query: string) {
  fireEvent.change(screen.getByLabelText("Search"), {
    target: { value: query },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
}

const mk = (id: string, score: number): SearchResult => ({
  id,
  thumb_url: `/api/thumbs/${id}`,
  bbox: [[[39, 21], [39.1, 21], [39.1, 21.1], [39, 21.1], [39, 21]]],
  score,
  captured_at: "2025-09-29T08:04:26Z",
});
const results = [mk("a", 0.91), mk("b", 0.42), mk("c", 0.1)];

let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  // Collect before restoring so a failure still cleans up the spies.
  const errors = consoleError.mock.calls.map((args: unknown[]) =>
    String(args[0]),
  );
  const warns = consoleWarn.mock.calls.map((args: unknown[]) =>
    String(args[0]),
  );
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

describe("cross-highlight", () => {
  it("row hover/focus emits onHover(id) and leave emits null", () => {
    const onHover = vi.fn();
    render(
      <ResultsPanel
        results={results}
        selectedId="a"
        onPick={() => {}}
        onHover={onHover}
      />,
    );
    const row = screen.getByRole("button", { name: /0\.91/ });
    fireEvent.focus(row);
    expect(onHover).toHaveBeenLastCalledWith("a");
    fireEvent.blur(row);
    expect(onHover).toHaveBeenLastCalledWith(null);
  });

  it("feeds row hover into the map's hoveredId prop and clears it on leave", async () => {
    stubFetch(200, { results });
    render(<DashboardPage />);
    submitQuery("water");

    const row = await screen.findByRole("button", { name: /0\.91/ });
    fireEvent.mouseEnter(row);
    expect(hoisted.mapProps?.hoveredId).toBe("a");
    fireEvent.mouseLeave(row);
    expect(hoisted.mapProps?.hoveredId).toBeNull();
  });
});

describe("detail prev/next", () => {
  it("DetailPanel prev/next navigates through results", () => {
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    render(
      <DetailPanel
        tile={results[0]}
        results={results}
        onClose={onClose}
        onNavigate={onNavigate}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /previous/i }));
    expect(onNavigate).toHaveBeenCalledWith(-1);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(onNavigate).toHaveBeenCalledWith(1);
  });

  it("arrow keys navigate when the panel is focused", () => {
    const onNavigate = vi.fn();
    render(
      <DetailPanel
        tile={results[0]}
        results={results}
        onClose={vi.fn()}
        onNavigate={onNavigate}
      />,
    );
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(onNavigate).toHaveBeenCalledWith(1);
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(onNavigate).toHaveBeenCalledWith(-1);
  });

  it("stops navigating on arrow keys after the panel unmounts", () => {
    const onNavigate = vi.fn();
    const { unmount } = render(
      <DetailPanel
        tile={results[0]}
        results={results}
        onClose={vi.fn()}
        onNavigate={onNavigate}
      />,
    );
    unmount();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("restores focus to the pressed nav button after the panel remounts", async () => {
    stubFetch(200, { results });
    render(<DashboardPage />);
    submitQuery("water");

    fireEvent.click(await screen.findByRole("button", { name: /0\.91/ }));
    const next = screen.getByRole("button", { name: "Next result" });
    // Simulate the browser's click-focus (jsdom does not move focus itself).
    next.focus();
    expect(document.activeElement).toBe(next);

    fireEvent.click(next);

    // The tile `key` remounts the panel — focus must land on the NEW node,
    // not fall back to <body>.
    const nextAgain = screen.getByRole("button", { name: "Next result" });
    expect(nextAgain).not.toBe(next);
    expect(document.activeElement).toBe(nextAgain);
  });

  it("disables prev/next when fewer than 2 results are selectable", async () => {
    stubFetch(200, { results: [results[0]] });
    render(<DashboardPage />);
    submitQuery("water");

    fireEvent.click(await screen.findByRole("button", { name: /0\.91/ }));

    expect(screen.getByRole("button", { name: "Previous result" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next result" })).toBeDisabled();
  });

  it("page: Next/Previous cycle the selection with wrap-around", async () => {
    stubFetch(200, { results });
    render(<DashboardPage />);
    submitQuery("water");

    fireEvent.click(await screen.findByRole("button", { name: /0\.91/ }));
    expect(screen.getByRole("button", { name: /0\.91/ })).toHaveAttribute(
      "aria-current",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "Next result" }));
    expect(screen.getByRole("button", { name: /0\.42/ })).toHaveAttribute(
      "aria-current",
      "true",
    );

    // b → a, then a (first) wraps backward to c (last).
    fireEvent.click(screen.getByRole("button", { name: "Previous result" }));
    expect(screen.getByRole("button", { name: /0\.91/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Previous result" }));
    expect(screen.getByRole("button", { name: /0\.10/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });
});

describe("map popup lifecycle", () => {
  const feature = {
    properties: {
      id: "a",
      score_display: "0.91",
      date: "2025-09-29",
      lng: 39.05,
      lat: 21.05,
    },
  };

  function markerClick(): (payload: unknown) => void {
    const map = hoisted.mapInstances[0];
    const call = map.on.mock.calls.find(
      (c: any[]) => c[0] === "click" && c[1] === "result-markers",
    );
    expect(call).toBeTruthy();
    return call[2];
  }

  it("keeps a single popup instance: previous removed, content via setDOMContent", () => {
    render(<MapView results={results} onPick={() => {}} />);
    const click = markerClick();

    act(() => {
      click({ features: [feature] });
    });
    const first = hoisted.popups.at(-1);
    expect(first).toBeDefined();

    act(() => {
      click({ features: [feature] });
    });
    const second = hoisted.popups.at(-1);

    // Close-before-reopen: a fresh instance, the previous one removed.
    expect(hoisted.popups).toHaveLength(2);
    expect(second).not.toBe(first);
    expect(first.remove).toHaveBeenCalledTimes(1);

    // Content is DOM-built, never string-HTML (audit setHTML concern).
    expect(second.setDOMContent).toHaveBeenCalledTimes(1);
    expect(second.setHTML).not.toHaveBeenCalled();
    const el = second.setDOMContent.mock.calls[0][0] as HTMLElement;
    expect(el.textContent).toContain("0.91");
    expect(el.textContent).toContain("2025-09-29");
    expect(second.addTo).toHaveBeenCalledWith(hoisted.mapInstances[0]);
  });

  it("removes the open popup and the map instance on unmount", () => {
    const { unmount } = render(<MapView results={results} onPick={() => {}} />);
    const map = hoisted.mapInstances[0];
    const click = markerClick();

    act(() => {
      click({ features: [feature] });
    });
    const popup = hoisted.popups.at(-1);
    expect(popup.addTo).toHaveBeenCalledWith(map);

    unmount();

    expect(popup.remove).toHaveBeenCalledTimes(1);
    expect(map.remove).toHaveBeenCalledTimes(1);
  });
});
