"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { apiFetch } from "../lib/api";
import type { Bbox, SearchResult } from "../lib/types";

export interface BboxDrawHandle {
  /** Feed a raw map click (`[lon, lat]`) into the two-click machine. */
  handleMapClick: (lonLat: [number, number]) => void;
}

export interface BboxDrawProps {
  /** Draw mode flag owned by the page — mirrored onto the toggle. */
  active: boolean;
  /** Flips draw mode on the page (the only writer of that flag). */
  onToggle: () => void;
  /** Polygon-draw flag owned by the page — mutually exclusive with rect
   *  (the page owns both). Optional so Task 6's renders without it stay
   *  type-clean (finding 13). */
  polygonMode?: boolean;
  /** Flips polygon draw mode on the page (the only writer of that flag). */
  onTogglePolygon?: () => void;
  /** Last submitted search text — sent as `q`, or `null` when there is none. */
  currentQuery: string;
  /** Lifts the bbox hits up so the page can merge them into the panel. */
  onResults: (results: SearchResult[]) => void;
  /** Hands the completed box to the page so it can draw the rectangle. */
  onRectangle: (bbox: Bbox) => void;
  /** Live preview of the in-progress box: a dot at corner A, the dashed box
   *  from corner B onward (it persists — R-6a). `null` clears the preview
   *  layer (Esc / toggle-off). */
  onPreview: (bbox: Bbox | null) => void;
  /** Hands the finalized polygon to the page so it can draw the shape.
   *  Optional for the same type-cleanliness reason as `polygonMode`. */
  onPolygon?: (polygon: [number, number][]) => void;
  /** Anything `apiFetch` throws — surfaced by the page as its alert. */
  onError: (error: unknown) => void;
  ref?: Ref<BboxDrawHandle>;
}

/** Vertex cap: the polygon API validates >64 points as 422, so the machine
 *  silently ignores click 65+ and the status strip reports the cap. */
const MAX_VERTICES = 64;

/**
 * Two-click bbox draw search (Task 19; live draw feedback, Task 6).
 *
 * The "Draw area" toggle arms the mode; the page forwards map clicks here
 * while it is armed. Click 1 records corner A (temp point/line + coordinates
 * in the status strip) and previews the degenerate box on the map (a Point —
 * the preview dot layer paints it). Click 2 normalizes the pair into an
 * ordered `[[w,s],[e,n]]`, then — visual-first (finding 8, R-6a) — emits
 * `onPreview(completedBox)` → `onRectangle(completedBox)` → POST. There is
 * deliberately NO preview clear in that tick: the dashed preview box keeps
 * painting, exactly overlaid by the persisted rectangle (identical geometry
 * stacked = no artifact), and on fetch error both stay visible next to the
 * page's alert. The preview is cleared by Esc or by toggling the tool off.
 * Esc aborts the in-progress rectangle without any request (the tool stays
 * armed); toggling the button off mid-draw also drops corner A. The toggle
 * disarms itself once a draw completes.
 *
 * Task 7 adds the free-polygon machine behind the second toggle ("Draw
 * polygon"): each map click appends a vertex (`[lon, lat]`, cap 64 —
 * silently ignored beyond, the status strip reports it), Enter or a
 * double-click near the last vertex closes the ring (≥3 vertices required;
 * both run the same `runPolygon` path), Esc clears the vertices but keeps
 * the mode armed. Close disarms FIRST, hands the finalized ring to the map
 * (`onPolygon`), then POSTs `/api/search/polygon` — the same
 * disarm → handoff → request order the rectangle machine uses, so the
 * page's clear-on-arm/disarm of the draw layers cannot wipe a shape that
 * has not been drawn yet.
 */
export default function BboxDraw({
  active,
  onToggle,
  polygonMode,
  onTogglePolygon,
  currentQuery,
  onResults,
  onRectangle,
  onPreview,
  onPolygon,
  onError,
  ref,
}: BboxDrawProps) {
  const [corner, setCornerState] = useState<[number, number] | null>(null);
  // State drives the status strip; the ref mirrors it so `handleMapClick`
  // sees corner A even when two clicks land before React flushes a re-render
  // (the imperative handle would otherwise close over a stale `corner`).
  const cornerRef = useRef<[number, number] | null>(null);
  function setCorner(next: [number, number] | null) {
    cornerRef.current = next;
    setCornerState(next);
  }

  // Polygon machine state — same choke-point pattern as corner/cornerRef so
  // `handleMapClick` and the keydown listener read fresh vertices even when
  // two clicks (or a click + Enter) land before React flushes a re-render.
  const [vertices, setVerticesState] = useState<[number, number][]>([]);
  const verticesRef = useRef<[number, number][]>([]);
  function setVertices(next: [number, number][]) {
    verticesRef.current = next;
    setVerticesState(next);
  }
  /** Timestamp of the latest vertex click — the double-click close gesture
   *  (0 = nothing recent; reset on close/Esc/toggle). */
  const lastClickAtRef = useRef<number>(0);
  /** Latest close path, read by the keydown listener through this ref so the
   *  effect does not have to chase per-render callbacks as dependencies. */
  const runPolygonRef = useRef<(polygon: [number, number][]) => void>(() => {});

  // Esc cancels the in-progress draw: temp visual + map preview cleared for
  // a rectangle, vertices cleared (mode stays armed) for a polygon — no
  // request either way. Enter closes the polygon (rect mode: no-op). The
  // effect is gated on `[active]` (armed in EITHER mode — that is what keeps
  // these listeners attached during polygon draw); `polygonMode` is a dep so
  // a rect→polygon switch with `active` held true never branches on a stale
  // mode, while vertices and the close path are read through refs (fresh even
  // before a re-render flushes).
  useEffect(() => {
    if (!active) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Enter") {
        const verts = verticesRef.current;
        if (polygonMode && verts.length >= 3) void runPolygonRef.current(verts);
        return;
      }
      if (event.key === "Escape") {
        if (polygonMode) {
          setVertices([]); // clears vertices but keeps the mode armed
          lastClickAtRef.current = 0;
          return;
        }
        setCorner(null);
        onPreview(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, polygonMode, onPreview]);

  async function runSearch(bbox: Bbox) {
    try {
      const data = await apiFetch<{ results: SearchResult[] }>(
        "/api/search/bbox",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bbox, q: currentQuery || null }),
        },
      );
      onResults(data.results);
      // The rectangle is NOT emitted here: visual-first (finding 8, R-6a)
      // hands it to the map at corner B, before the request leaves, so a
      // failed search keeps the drawn box (and its dashed preview) on screen
      // and only raises the alert.
    } catch (error) {
      onError(error);
    }
  }

  /** Close path for BOTH gestures (Enter and double-click): reset → disarm →
   *  hand the finalized ring to the map → POST → lift the hits. The order
   *  mirrors the rectangle machine's `onToggle()` → visual handoff → request:
   *  disarm first so the page's clear-on-arm/disarm cannot wipe the shape,
   *  `onPolygon` synchronously so it is on the map before the request leaves
   *  (a failed search keeps it visible next to the alert), results lifted
   *  when the POST resolves. */
  async function runPolygon(polygon: [number, number][]) {
    if (polygon.length < 3) return;
    setVertices([]); // reset after send
    lastClickAtRef.current = 0;
    onTogglePolygon?.(); // disarm — the page owns both draw flags
    onPolygon?.(polygon);
    try {
      const data = await apiFetch<{ results: SearchResult[] }>(
        "/api/search/polygon",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ polygon, q: currentQuery || null }),
        },
      );
      onResults(data.results);
    } catch (error) {
      onError(error);
    }
  }
  runPolygonRef.current = runPolygon; // the keydown listener always sees the latest closure

  function handleMapClick(lonLat: [number, number]) {
    // Branch precedence (binding): polygon FIRST — during polygon draw the
    // page passes active=true AND polygonMode=true at once, and the rect
    // machine below must be unreachable in that state.
    if (polygonMode) {
      const verts = verticesRef.current;
      const now = Date.now();
      // Double-click close (finding 16) — owned here; Map only forwards
      // clicks: a rapid (<250ms) second click within 1e-6° of the last
      // vertex closes the ring instead of appending a duplicate vertex.
      const closeGesture =
        verts.length >= 3 &&
        now - lastClickAtRef.current < 250 &&
        Math.hypot(
          lonLat[0] - verts[verts.length - 1][0],
          lonLat[1] - verts[verts.length - 1][1],
        ) < 1e-6;
      if (closeGesture) {
        lastClickAtRef.current = 0;
        void runPolygon(verts); // same path as Enter — close, never append
        return;
      }
      lastClickAtRef.current = now;
      if (verts.length >= MAX_VERTICES) return; // cap — silently ignore (strip reports it)
      setVertices([...verts, lonLat]);
      return;
    }
    if (!active) return;
    const cornerA = cornerRef.current; // fresh even before a re-render flushes
    if (cornerA === null) {
      setCorner(lonLat);
      onPreview([lonLat, lonLat]); // degenerate box — preview from click 1
      return;
    }
    // Corner B: normalize so the box is always [[w,s],[e,n]] (w<e, s<n).
    const bbox: Bbox = [
      [Math.min(cornerA[0], lonLat[0]), Math.min(cornerA[1], lonLat[1])],
      [Math.max(cornerA[0], lonLat[0]), Math.max(cornerA[1], lonLat[1])],
    ];
    setCorner(null);
    onToggle(); // one draw per arm — disarm before the request leaves
    // Corner-B sequence (finding 8, amended by R-6a): preview(completed) →
    // persisted rectangle (stacked on top) → POST. No same-tick preview
    // clear — that would race maplibre's render and paint nothing; the
    // dashed box persists until Esc or a re-arm clears it.
    onPreview(bbox);
    onRectangle(bbox);
    void runSearch(bbox);
  }

  useImperativeHandle(
    ref,
    () => ({ handleMapClick }),
    [
      active,
      polygonMode,
      currentQuery,
      onResults,
      onRectangle,
      onPreview,
      onError,
      onToggle,
      onTogglePolygon,
      onPolygon,
    ],
  );

  function handleToggleClick() {
    setCorner(null); // a fresh session never inherits a stale corner A
    setVertices([]); // …nor polygon vertices from the other mode
    lastClickAtRef.current = 0;
    onPreview(null); // …nor a stale dashed preview
    onToggle();
  }

  function handleTogglePolygonClick() {
    setVertices([]); // a fresh session never inherits stale vertices
    lastClickAtRef.current = 0;
    setCorner(null); // …nor a pending rect corner from the other mode
    onPreview(null); // …nor a stale dashed preview
    onTogglePolygon?.();
  }

  return (
    <div style={{ display: "flex", gap: "var(--space-2xs)", alignItems: "center", flexWrap: "wrap" }}>
      <button
        type="button"
        className="button button--ghost"
        aria-pressed={active && !polygonMode}
        onClick={handleToggleClick}
      >
        Draw area
      </button>
      <button
        type="button"
        className="button button--ghost"
        aria-pressed={active && polygonMode}
        onClick={handleTogglePolygonClick}
      >
        Draw polygon
      </button>
      {active && !polygonMode && (
        <p
          role="status"
          style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--color-ink-soft)" }}
        >
          {corner === null ? (
            "Click the map to set corner A (Esc cancels)."
          ) : (
            <>
              {/* Temp point/line: filled corner A → pending corner B. */}
              <svg
                width="52"
                height="12"
                aria-hidden="true"
                focusable="false"
                style={{ verticalAlign: "middle", marginRight: 6 }}
              >
                <line
                  x1="6"
                  y1="6"
                  x2="46"
                  y2="6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeDasharray="5 4"
                />
                <circle cx="6" cy="6" r="4.5" fill="currentColor" />
                <circle cx="46" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="2" />
              </svg>
              {`Corner A: ${corner[0].toFixed(4)}, ${corner[1].toFixed(4)} — click the opposite corner (Esc cancels).`}
            </>
          )}
        </p>
      )}
      {active && polygonMode && (
        <p
          role="status"
          style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--color-ink-soft)" }}
        >
          {/* Pinned singular/plural (Task 10's e2e greps /^1 vertex —/; the
              "0 vertices" text must NOT match it) + the 64-cap report. */}
          {vertices.length >= MAX_VERTICES
            ? `${vertices.length} vertices — 64 vertex cap, Enter/double-click to close (Esc clears).`
            : `${vertices.length} ${vertices.length === 1 ? "vertex" : "vertices"} — click to add, Enter/double-click to close (Esc clears).`}
        </p>
      )}
    </div>
  );
}
