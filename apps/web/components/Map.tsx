"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import type { Feature, FeatureCollection } from "geojson";
import {
  Map as MapLibreMap,
  Popup,
  setWorkerUrl,
  type GeoJSONSource,
  type StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Bbox, SearchResult } from "../lib/types";

/**
 * R13(b) — pin the worker to the copy in `public/`.
 *
 * maplibre-gl v6's default worker URL is `new URL('./maplibre-gl-worker.mjs',
 * import.meta.url)`, guarded by `/^https?:/` on `import.meta.url`. Webpack
 * statically rewrites `import.meta.url` to the build-time `file://` module
 * path in the prod bundle, so that default resolves to `""` → `new Worker('')`
 * → the page URL → "Worker failed to load" and no GeoJSON layer (result
 * markers, draw rectangle) ever renders. The static asset is synced from
 * node_modules by `scripts/sync-maplibre-worker.mjs` (predev/prebuild hooks).
 */
setWorkerUrl("/maplibre-gl-worker.mjs");

/** Container element plus the R13(e2e) observational handle (see below). */
type MapContainer = HTMLDivElement & { __maplibreMap?: MapLibreMap };

const ESRI_TILES =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

const ESRI_SOURCE = "esri";
const OSM_SOURCE = "osm";
const RESULTS_SOURCE = "results";
const RECTANGLE_SOURCE = "rectangle";
const PREVIEW_SOURCE = "preview";
const POLYGON_SOURCE = "polygon";
const OSM_LAYER = "osm-streets";
const MARKERS_LAYER = "result-markers";
const RECTANGLE_FILL_LAYER = "draw-rectangle";
const RECTANGLE_LINE_LAYER = "draw-rectangle-outline";
const PREVIEW_LINE_LAYER = "draw-preview";
const PREVIEW_DOT_LAYER = "draw-preview-dot";
const POLYGON_FILL_LAYER = "draw-polygon-fill";
const POLYGON_LINE_LAYER = "draw-polygon";

/**
 * Brand accent as a paint literal (finding 17): maplibre paint properties
 * cannot resolve CSS custom properties, so the dashed draw-preview layer
 * takes this named constant instead of a scattered magic literal. Mirrors
 * `--color-accent` in `tokens.css`; Task 7's `draw-polygon` layer reuses it.
 */
const ACCENT_HEX = "#0b6f8f";

const EMPTY_FC: FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

/** ESRI World Imagery basemap + OSM streets overlay (hidden until toggled)
 *  + an empty GeoJSON source for the score-colored result markers
 *  + an empty GeoJSON source for the drawn search rectangle (Task 19)
 *  + an empty GeoJSON source for the live draw preview — corner-A dot and
 *    dashed box (Task 6, R-6a)
 *  + an empty GeoJSON source for the finalized free polygon (Task 7). */
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
      data: EMPTY_FC,
    },
    [RECTANGLE_SOURCE]: {
      type: "geojson",
      data: EMPTY_FC,
    },
    [PREVIEW_SOURCE]: {
      type: "geojson",
      data: EMPTY_FC,
    },
    [POLYGON_SOURCE]: {
      type: "geojson",
      data: EMPTY_FC,
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
      id: RECTANGLE_FILL_LAYER,
      type: "fill",
      source: RECTANGLE_SOURCE,
      paint: { "fill-color": "#2563eb", "fill-opacity": 0.22 },
    },
    {
      id: RECTANGLE_LINE_LAYER,
      type: "line",
      source: RECTANGLE_SOURCE,
      paint: { "line-color": "#2563eb", "line-width": 2 },
    },
    {
      // Dashed live preview of the in-progress box (Task 6, R-6a): from
      // corner B it persists exactly under the persisted rectangle (identical
      // geometry stacked = no artifact), so a failed fetch still shows the
      // drawn box next to the alert. Polygons only — Points are the dot's.
      id: PREVIEW_LINE_LAYER,
      type: "line",
      source: PREVIEW_SOURCE,
      filter: ["!=", ["geometry-type"], "Point"],
      paint: {
        "line-color": ACCENT_HEX,
        "line-width": 2,
        "line-dasharray": [2, 2],
      },
    },
    {
      // R-6a corner-A dot: the degenerate click-1 box is stored as a Point
      // feature (a zero-length ring paints nothing), and circle buckets draw
      // EVERY vertex of every feature they receive — hence the Point-only
      // filter, or the completed box would bloom with dots at its corners.
      id: PREVIEW_DOT_LAYER,
      type: "circle",
      source: PREVIEW_SOURCE,
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-radius": 5,
        "circle-color": ACCENT_HEX,
        "circle-opacity": 0.9,
      },
    },
    {
      // Task 7 finalized free polygon: 15% accent wash under the stroke.
      // NO geometry-type filter — the source holds one closed LineString and
      // fill buckets triangulate whatever ring they receive (classifyRings
      // gates only on the feature filter, not on geometry type), while a
      // `Polygon`-only filter would starve the fill of its only feature.
      id: POLYGON_FILL_LAYER,
      type: "fill",
      source: POLYGON_SOURCE,
      paint: { "fill-color": ACCENT_HEX, "fill-opacity": 0.15 },
    },
    {
      // Solid accent stroke of the finalized ring (auto-closed on render) —
      // same ACCENT_HEX paint constant as the preview (finding 17), but
      // solid rather than dashed to read as "committed".
      id: POLYGON_LINE_LAYER,
      type: "line",
      source: POLYGON_SOURCE,
      paint: { "line-color": ACCENT_HEX, "line-width": 2 },
    },
    {
      id: MARKERS_LAYER,
      type: "circle",
      source: RESULTS_SOURCE,
      paint: {
        // Cross-highlight (Task 9): the hovered feature (its GeoJSON `hover`
        // property is rebuilt from the single `hoveredId` prop — no
        // per-result listeners) paints accent + larger; everyone else keeps
        // the plain white-ringed 7px marker.
        "circle-radius": [
          "case",
          ["==", ["get", "hover"], true],
          11,
          7,
        ],
        "circle-stroke-width": 1.5,
        "circle-stroke-color": "#ffffff",
        // Score ramp: low score = deep blue → high score = yellow.
        "circle-color": [
          "case",
          ["==", ["get", "hover"], true],
          ACCENT_HEX,
          [
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

function toFeatureCollection(
  results: SearchResult[],
  hoveredId: string | null | undefined,
): FeatureCollection {
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
          // The marker paint reads this in its `case` expression — the whole
          // cross-highlight is one data push, never a per-marker listener.
          hover: result.id === hoveredId,
        },
      } satisfies Feature;
    }),
  };
}

/** Closed outer ring for the drawn search box (counter-clockwise from SW). */
function toRectangleCollection(bbox: Bbox): FeatureCollection {
  const [[w, s], [e, n]] = bbox;
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]],
        },
        properties: {},
      } satisfies Feature,
    ],
  };
}

/** Preview geometry for a box: a Point when it is degenerate (click 1's
 *  `[lonLat, lonLat]`, or a same-point corner B) so the circle layer can
 *  paint the visible corner-A dot — a zero-length ring draws nothing. Any
 *  other box is the closed ring the dashed line layer strokes. */
function toPreviewCollection(bbox: Bbox): FeatureCollection {
  const [[w, s], [e, n]] = bbox;
  if (w === e && s === n) {
    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [w, s] },
          properties: {},
        } satisfies Feature,
      ],
    };
  }
  return toRectangleCollection(bbox);
}

/** Closed ring for the finalized free polygon (Task 7): the first point is
 *  appended when the caller's vertex list is open ("auto-close on render").
 *  Stored as a GeoJSON LineString — the `draw-polygon` line layer strokes
 *  the whole loop, and the fill layer triangulates the same ring for the
 *  15% wash (no geometry-type filter on either layer). */
function toPolygonCollection(coords: [number, number][]): FeatureCollection {
  if (coords.length < 3) return EMPTY_FC;
  const ring: number[][] = coords.map(([lon, lat]) => [lon, lat]);
  const [firstLon, firstLat] = coords[0];
  const [lastLon, lastLat] = coords[coords.length - 1];
  if (lastLon !== firstLon || lastLat !== firstLat) ring.push([firstLon, firstLat]);
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "LineString", coordinates: ring },
        properties: {},
      } satisfies Feature,
    ],
  };
}

/** Imperative map handles (Task 19): render/clear the drawn search rectangle;
 *  Task 6 adds the live dashed preview (R-6a); Task 7 adds the finalized
 *  free-polygon ring. */
export interface MapHandle {
  /** Draw the given box, or pass `null` to clear it (empty GeoJSON data). */
  setRectangle: (bbox: Bbox | null) => void;
  /** Draw (or clear with `null`) the live preview: a dot at corner A, then
   *  the dashed `draw-preview` box — which from corner B persists (stacked
   *  under the persisted rectangle) until the page clears it on Esc/re-arm.
   *  Distinct from the `draw-rectangle` layer; both die with `map.remove()`. */
  setPreviewRectangle: (bbox: Bbox | null) => void;
  /** Draw the finalized free-polygon ring (auto-closed on render) in the
   *  solid `draw-polygon` line + 15% fill layers, or clear with `null` —
   *  the page clears it on arm/disarm of either draw tool (Task 7). */
  setPolygon: (coords: [number, number][] | null) => void;
}

export interface MapProps {
  results: SearchResult[];
  onPick: (id: string) => void;
  /** Cross-highlight (Task 9): the hovered hit id — marker paint (accent +
   *  larger radius) derives from it in the `circle-*` expressions. No
   *  per-result listeners; a single data push repaints every marker. */
  hoveredId?: string | null;
  /** Latest draw-mode map click as `[lon, lat]`; only passed while drawing. */
  onMapClick?: (lonLat: [number, number]) => void;
  ref?: Ref<MapHandle>;
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
 * source and flies to the first hit. Task 9 adds the `hoveredId`
 * cross-highlight (one data push repaints the hovered marker accent+larger)
 * and reworks the popup into a single ref-held instance, closed before every
 * reopen and on unmount, whose content is built with `createElement` +
 * `textContent` (no `setHTML`).
 *
 * Task 19: a plain map `click` listener forwards `[lon, lat]` to the latest
 * `onMapClick` (the page only supplies one while draw mode is armed), and the
 * ref handle `setRectangle(bbox | null)` renders or clears the search box on
 * the dedicated GeoJSON source. Task 6 adds `setPreviewRectangle(bbox | null)`
 * driving the live preview: the `draw-preview-dot` circle at corner A and the
 * dashed `draw-preview` box that persists from corner B (R-6a). Task 7 adds
 * `setPolygon(coords | null)` for the finalized free-polygon ring (solid
 * `draw-polygon` stroke + 15% fill). Map only forwards clicks — the
 * double-click close gesture lives in BboxDraw. All listeners die with
 * `map.remove()` (which takes the style — sources and layers — with it).
 */
export default function Map({
  results,
  onPick,
  hoveredId,
  onMapClick,
  ref,
}: MapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  // Keep the latest callbacks without re-running the init effect.
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;
  // Latest requested boxes, so a deferred `load` apply uses current data.
  const rectangleRef = useRef<Bbox | null>(null);
  const previewRectangleRef = useRef<Bbox | null>(null);
  const polygonRef = useRef<[number, number][] | null>(null);
  // Single popup instance (Task 9, audit major #6): closed before every
  // reopen and on unmount — never a leak of stacked string-HTML popups.
  const popupRef = useRef<Popup | null>(null);
  // The results effect re-runs on `results` alone (so hovers don't re-fly);
  // this mirror keeps its deferred apply painted with the current hover.
  const hoveredIdRef = useRef(hoveredId);
  hoveredIdRef.current = hoveredId;
  const [osmVisible, setOsmVisible] = useState(false);

  // Shared shape for all draw layers: record the latest shape, then push it
  // into the GeoJSON source — immediately once the style has loaded, else on
  // the next `load` (reading the ref then, so late applies see fresh data).
  function applyBox<T>(
    sourceId: string,
    boxRef: { current: T | null },
    toCollection: (shape: T) => FeatureCollection,
  ): void {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const current = boxRef.current;
      const source = map.getSource(sourceId) as GeoJSONSource | undefined;
      source?.setData(current ? toCollection(current) : EMPTY_FC);
    };
    if (map.getSource(sourceId)) apply();
    else map.once("load", apply);
  }

  useImperativeHandle(ref, () => ({
    setRectangle(bbox: Bbox | null) {
      rectangleRef.current = bbox;
      applyBox(RECTANGLE_SOURCE, rectangleRef, toRectangleCollection);
    },
    setPreviewRectangle(bbox: Bbox | null) {
      previewRectangleRef.current = bbox;
      applyBox(PREVIEW_SOURCE, previewRectangleRef, toPreviewCollection);
    },
    setPolygon(coords: [number, number][] | null) {
      polygonRef.current = coords;
      applyBox(POLYGON_SOURCE, polygonRef, toPolygonCollection);
    },
  }), []);

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
    // E2E handle (R13): Playwright asserts the worker-backed GeoJSON layers
    // actually render via `container.__maplibreMap.queryRenderedFeatures(...)`.
    // Purely observational — no app code reads it.
    (container as MapContainer).__maplibreMap = map;

    map.on("click", MARKERS_LAYER, (event) => {
      const feature = event.features?.[0];
      if (!feature) return;
      const { id, score_display, date, lng, lat } = feature.properties;
      // Close-before-reopen: one popup at a time (audit major #6).
      popupRef.current?.remove();
      // DOM-built content — `textContent`, never `setHTML` string
      // interpolation (the audit's XSS-by-concatenation concern).
      const el = document.createElement("div");
      const score = document.createElement("strong");
      score.textContent = `Score ${String(score_display)}`;
      const day = document.createElement("div");
      day.textContent = String(date);
      el.append(score, day);
      popupRef.current = new Popup()
        .setLngLat([Number(lng), Number(lat)])
        .setDOMContent(el)
        .addTo(map);
      if (typeof id === "string") onPickRef.current(id);
    });

    // Draw-mode feed: fires only when the page supplied an `onMapClick`
    // (i.e. while the "Draw area" toggle is armed).
    map.on("click", (event) => {
      const handle = onMapClickRef.current;
      if (!handle) return;
      handle([event.lngLat.lng, event.lngLat.lat]);
    });

    return () => {
      delete (container as MapContainer).__maplibreMap;
      popupRef.current?.remove();
      popupRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Fresh results: push the collection (painted with the CURRENT hover via
  // the mirror ref) and fly to the first hit — hovers re-run only the effect
  // below, so pointing at rows never re-fires the camera.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      const source = map.getSource(RESULTS_SOURCE) as
        | GeoJSONSource
        | undefined;
      source?.setData(toFeatureCollection(results, hoveredIdRef.current));
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

  // Cross-highlight (Task 9): re-push the same results with the new `hover`
  // flags — one data-driven repaint, no per-marker listeners (Review Focus
  // #4: nothing here accumulates across hovers).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      const source = map.getSource(RESULTS_SOURCE) as
        | GeoJSONSource
        | undefined;
      source?.setData(toFeatureCollection(results, hoveredId));
    };

    if (map.getSource(RESULTS_SOURCE)) {
      apply();
    } else {
      map.once("load", apply);
    }
  }, [results, hoveredId]);

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
