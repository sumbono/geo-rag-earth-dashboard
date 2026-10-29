/**
 * Fix-pass (final review Critical 1): the coverage fetch effect was declared
 * before the map-creation effect, so on mount `mapRef.current` was still null
 * and — with `[]` deps — the fetch never ran. This test pins the ordering:
 * mount the real Map with its own mocks and assert the coverage fetch fires.
 * This file owns its mocks (maplibre + lib/api) so other suites' fetch counts
 * and map mocks stay untouched.
 */
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => {
  const mapInstances: Array<{
    setData: ReturnType<typeof vi.fn>;
    getSource: ReturnType<typeof vi.fn>;
  }> = [];

  class MockPopup {
    setLngLat = vi.fn((): unknown => this);
    setHTML = vi.fn((): unknown => this);
    setDOMContent = vi.fn((): unknown => this);
    addTo = vi.fn((): unknown => this);
    remove = vi.fn();
  }

  class MockMap {
    setData = vi.fn();
    on = vi.fn();
    once = vi.fn();
    remove = vi.fn();
    isStyleLoaded = vi.fn(() => true);
    // The style spec declares coverage-source up front, so a faithful mock
    // reports it as soon as the map exists (mirrors Map.tsx's static style).
    getSource = vi.fn((id?: string) =>
      id === "coverage-source" ? { setData: this.setData } : undefined,
    );
    constructor(_options: unknown) {
      mapInstances.push(this as unknown as (typeof mapInstances)[number]);
    }
  }

  return { MockMap, MockPopup, mapInstances };
});

vi.mock("maplibre-gl", () => ({
  default: { Map: hoisted.MockMap, Popup: hoisted.MockPopup },
  Map: hoisted.MockMap,
  Popup: hoisted.MockPopup,
  setWorkerUrl: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  apiFetch: vi.fn(async (path: string) => {
    if (path === "/api/coverage") {
      return { type: "FeatureCollection", features: [] };
    }
    throw new Error(`unexpected apiFetch path: ${path}`);
  }),
}));

import { apiFetch } from "../lib/api";
import MapView from "../components/Map";

describe("Map coverage footprint fetch (fix-pass Critical 1)", () => {
  it("fetches /api/coverage once the map exists and pushes data into the source", async () => {
    render(<MapView results={[]} onPick={() => {}} />);

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/coverage"));
    const instance = hoisted.mapInstances[0];
    expect(instance).toBeDefined();
    expect(instance.setData).toHaveBeenCalledWith({
      type: "FeatureCollection",
      features: [],
    });
  });
});
