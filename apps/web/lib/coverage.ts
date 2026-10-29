/** Coverage layer pieces (fix-improve Task 4): Map.tsx declares sources and
 *  layers in its static style spec (it never calls addSource/addLayer), so
 *  the coverage outline is declared there too and its data swapped in later
 *  via GeoJSONSource.setData after `GET /api/coverage` resolves.
 *
 *  The accent color is a parameter: Map.tsx owns ACCENT_HEX (the design
 *  gate's sanctioned named constant) and supplies it — this module never
 *  invents a paint literal of its own. */

export const COVERAGE_SOURCE = "coverage-source";
export const COVERAGE_LAYER = "coverage-outline";

interface EmptyFC {
  type: "FeatureCollection";
  features: never[];
}

export interface CoverageLayerSpec {
  sourceId: string;
  layerId: string;
  source: { type: "geojson"; data: EmptyFC };
  layer: {
    id: string;
    type: "line";
    source: string;
    paint: {
      "line-color": string;
      "line-width": number;
      "line-dasharray": number[];
    };
  };
}

export function buildCoverageLayerSpec(accentHex: string): CoverageLayerSpec {
  return {
    sourceId: COVERAGE_SOURCE,
    layerId: COVERAGE_LAYER,
    source: {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    },
    layer: {
      id: COVERAGE_LAYER,
      type: "line",
      source: COVERAGE_SOURCE,
      paint: {
        "line-color": accentHex,
        "line-width": 1.5,
        // Dashed, unlike the solid draw strokes: "context", not "committed".
        "line-dasharray": [4, 2],
      },
    },
  };
}
