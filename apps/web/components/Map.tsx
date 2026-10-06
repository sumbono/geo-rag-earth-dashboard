"use client";

import { useEffect, useRef, useState } from "react";
import type { Feature, FeatureCollection } from "geojson";
import {
  Map as MapLibreMap,
  Popup,
  type GeoJSONSource,
  type StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { SearchResult } from "../lib/types";

const ESRI_TILES =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

const ESRI_SOURCE = "esri";
const OSM_SOURCE = "osm";
const RESULTS_SOURCE = "results";
const OSM_LAYER = "osm-streets";
const MARKERS_LAYER = "result-markers";

const EMPTY_RESULTS: FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

/** ESRI World Imagery basemap + OSM streets overlay (hidden until toggled)
 *  + an empty GeoJSON source for the score-colored result markers. */
const style: StyleSpecification = {
  version: 8,
  sources: {
    [ESRI_SOURCE]: {
      type: "raster",
      tiles: [ESRI_TILES],
      tileSize: 256,
      maxzoom: 19,
      attribution: "Esri",
    },
    [OSM_SOURCE]: {
      type: "raster",
      tiles: [OSM_TILES],
      tileSize: 256,
      maxzoom: 19,
      attribution: "© OpenStreetMap contributors",
    },
    [RESULTS_SOURCE]: {
      type: "geojson",
      data: EMPTY_RESULTS,
    },
  },
  layers: [
    { id: "esri-imagery", type: "raster", source: ESRI_SOURCE },
    {
      id: OSM_LAYER,
      type: "raster",
      source: OSM_SOURCE,
      layout: { visibility: "none" },
    },
    {
      id: MARKERS_LAYER,
      type: "circle",
      source: RESULTS_SOURCE,
      paint: {
        "circle-radius": 7,
        "circle-stroke-width": 1.5,
        "circle-stroke-color": "#ffffff",
        // Score ramp: low score = deep blue → high score = yellow.
        "circle-color": [
          "interpolate",
          ["linear"],
          ["get", "score"],
          0,
          "#2563eb",
          0.5,
          "#38bdf8",
          1,
          "#facc15",
        ],
      },
    },
  ],
};

/** Centroid of a GeoJSON Polygon's outer ring (closing duplicate dropped). */
function ringCentroid(ring: number[][]): [number, number] {
  const closed =
    ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1];
  const points = closed ? ring.slice(0, -1) : ring;
  let sumLng = 0;
  let sumLat = 0;
  for (const point of points) {
    sumLng += point[0];
    sumLat += point[1];
  }
  const count = Math.max(points.length, 1);
  return [sumLng / count, sumLat / count];
}

function toFeatureCollection(results: SearchResult[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: results.map((result) => {
      const [lng, lat] = ringCentroid(result.bbox[0]);
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [lng, lat] },
        properties: {
          id: result.id,
          score: result.score,
          score_display: result.score.toFixed(2),
          date: result.captured_at.slice(0, 10),
          lng,
          lat,
        },
      } satisfies Feature;
    }),
  };
}

export interface MapProps {
  results: SearchResult[];
  onPick: (id: string) => void;
}

/**
 * MapLibre map for the dashboard (Task 17).
 *
 * ESRI World Imagery basemap (attribution `Esri`) with an OSM streets raster
 * toggled by the overlay button; one circle marker per result at its bbox
 * centroid, colored by score, with a score/date popup that reports the pick
 * via `onPick`. The map is created once in an effect (SSR never runs it; the
 * `typeof window` guard is belt-and-braces) and destroyed with `map.remove()`
 * on unmount. Each `results` change pushes a fresh FeatureCollection into the
 * source and flies to the first hit.
 */
export default function Map({ results, onPick }: MapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  // Keep the latest onPick without re-running the init effect.
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const [osmVisible, setOsmVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const container = containerRef.current;
    if (!container) return;

    const map = new MapLibreMap({
      container,
      center: [39, 22], // Saudi Red Sea coast
      zoom: 6,
      style,
    });
    mapRef.current = map;

    map.on("click", MARKERS_LAYER, (event) => {
      const feature = event.features?.[0];
      if (!feature) return;
      const { id, score_display, date, lng, lat } = feature.properties;
      new Popup()
        .setLngLat([Number(lng), Number(lat)])
        .setHTML(`<strong>${String(score_display)}</strong><br/>${String(date)}`)
        .addTo(map);
      if (typeof id === "string") onPickRef.current(id);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      const source = map.getSource(RESULTS_SOURCE) as
        | GeoJSONSource
        | undefined;
      source?.setData(toFeatureCollection(results));
      if (results.length > 0) {
        map.flyTo({ center: ringCentroid(results[0].bbox[0]), zoom: 10 });
      }
    };

    // The source exists once the style has loaded; before that, defer.
    if (map.getSource(RESULTS_SOURCE)) {
      apply();
    } else {
      map.once("load", apply);
    }
  }, [results]);

  function toggleOsm() {
    const next = !osmVisible;
    setOsmVisible(next);
    const map = mapRef.current;
    if (!map) return;
    const apply = () =>
      map.setLayoutProperty(OSM_LAYER, "visibility", next ? "visible" : "none");
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }

  return (
    <div
      style={{
        position: "relative",
        height: "min(60vh, 560px)",
        minHeight: 320,
        borderRadius: 6,
        overflow: "hidden",
      }}
    >
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
      <button
        type="button"
        className="button button--ghost"
        aria-pressed={osmVisible}
        onClick={toggleOsm}
        style={{ position: "absolute", top: 8, right: 8, zIndex: 1 }}
      >
        OSM streets
      </button>
    </div>
  );
}
