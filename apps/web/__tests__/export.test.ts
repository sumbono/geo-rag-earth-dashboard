import { describe, expect, it, vi } from "vitest";
import { resultsToCSV, resultsToGeoJSON, downloadText } from "../lib/export";
import type { SearchResult } from "../lib/types";

const FIXTURE: SearchResult[] = [
  {
    id: "tile-1",
    thumb_url: "/api/thumbs/tile-1",
    bbox: [
      [
        [36.0, 17.1],
        [36.1, 17.1],
        [36.1, 17.2],
        [36.0, 17.2],
        [36.0, 17.1],
      ],
    ],
    score: 0.3,
    captured_at: "2026-10-05T00:00:00Z",
  },
];

describe("resultsToGeoJSON", () => {
  it("emits a FeatureCollection with one Polygon feature per result", () => {
    const fc = JSON.parse(resultsToGeoJSON(FIXTURE));
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toHaveLength(1);
    const f = fc.features[0];
    expect(f.geometry.type).toBe("Polygon");
    expect(f.geometry.coordinates).toEqual(FIXTURE[0].bbox); // ring nesting preserved
    expect(f.properties).toMatchObject({
      id: "tile-1",
      score: 0.3,
      captured_at: "2026-10-05T00:00:00Z",
    });
  });
});

describe("resultsToCSV", () => {
  it("emits header + one row per result", () => {
    expect(resultsToCSV(FIXTURE)).toBe(
      "id,score,captured_at\ntile-1,0.3,2026-10-05T00:00:00Z",
    );
  });
});

describe("downloadText", () => {
  it("creates an object URL, clicks a temp anchor, revokes the URL", () => {
    const create = vi.fn(() => "blob:mock");
    const revoke = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.fn();
    vi.stubGlobal("document", {
      createElement: () => ({ click, set href(_v: string) {}, set download(_v: string) {} }),
    });
    downloadText("results.geojson", "application/geo+json", "{}");
    expect(create).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith("blob:mock");
    vi.unstubAllGlobals();
  });
});
