import { describe, expect, it } from "vitest";
import {
  buildCoverageLayerSpec,
  COVERAGE_LAYER,
  COVERAGE_SOURCE,
} from "../lib/coverage";

describe("buildCoverageLayerSpec (fix-improve Task 4)", () => {
  it("returns a geojson source seeded with an empty FeatureCollection", () => {
    const spec = buildCoverageLayerSpec("#0b6f8f");
    expect(spec.sourceId).toBe(COVERAGE_SOURCE);
    expect(spec.sourceId).toBe("coverage-source");
    expect(spec.source.type).toBe("geojson");
    expect(spec.source.data).toEqual({ type: "FeatureCollection", features: [] });
  });

  it("returns a dashed line layer bound to that source", () => {
    const spec = buildCoverageLayerSpec("#0b6f8f");
    expect(spec.layerId).toBe(COVERAGE_LAYER);
    expect(spec.layerId).toBe("coverage-outline");
    expect(spec.layer.type).toBe("line");
    expect(spec.layer.source).toBe(COVERAGE_SOURCE);
    expect(spec.layer.paint["line-dasharray"]).toEqual([4, 2]);
    expect(spec.layer.paint["line-width"]).toBe(1.5);
    // The caller supplies the sanctioned accent (Map.tsx ACCENT_HEX) — the
    // builder never invents a color of its own.
    expect(spec.layer.paint["line-color"]).toBe("#0b6f8f");
  });
});
