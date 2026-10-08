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
  /** Last submitted search text — sent as `q`, or `null` when there is none. */
  currentQuery: string;
  /** Lifts the bbox hits up so the page can merge them into the panel. */
  onResults: (results: SearchResult[]) => void;
  /** Hands the completed box to the page so it can draw the rectangle. */
  onRectangle: (bbox: Bbox) => void;
  /** Live preview of the in-progress box (degenerate at corner A, full at
   *  corner B) — `null` clears the dashed preview layer (Task 6). */
  onPreview: (bbox: Bbox | null) => void;
  /** Anything `apiFetch` throws — surfaced by the page as its alert. */
  onError: (error: unknown) => void;
  ref?: Ref<BboxDrawHandle>;
}

/**
 * Two-click bbox draw search (Task 19; live draw feedback, Task 6).
 *
 * The "Draw area" toggle arms the mode; the page forwards map clicks here
 * while it is armed. Click 1 records corner A (temp point/line + coordinates
 * in the status strip) and previews the degenerate box on the map. Click 2
 * normalizes the pair into an ordered `[[w,s],[e,n]]`, then — visual-first
 * (finding 8) — flashes the completed box on the preview layer, hands it to
 * `onRectangle` so the persisted rectangle is on the map immediately,
 * clears the preview, and only then POSTs once to `/api/search/bbox` with
 * `q: currentQuery || null`, lifting the hits into the panel. On fetch error
 * the rectangle stays (the user sees what they drew) and the page's alert
 * explains the failure. Esc aborts the in-progress rectangle without any
 * request (the tool stays armed); toggling the button off mid-draw also
 * drops corner A. The toggle disarms itself once a draw completes.
 */
export default function BboxDraw({
  active,
  onToggle,
  currentQuery,
  onResults,
  onRectangle,
  onPreview,
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

  // Esc cancels the in-progress rectangle: temp visual + map preview cleared,
  // no request. `onPreview` is an inline page callback, hence the dep.
  useEffect(() => {
    if (!active) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setCorner(null);
        onPreview(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, onPreview]);

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
      // The rectangle is NOT emitted here: visual-first (finding 8) hands it
      // to the map at corner B, before the request leaves, so a failed
      // search keeps the drawn box on screen and only raises the alert.
    } catch (error) {
      onError(error);
    }
  }

  function handleMapClick(lonLat: [number, number]) {
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
    // Exact corner-B sequence (finding 8): preview(completed) → persisted
    // rectangle takes over → preview cleared → POST.
    onPreview(bbox);
    onRectangle(bbox);
    onPreview(null);
    void runSearch(bbox);
  }

  useImperativeHandle(
    ref,
    () => ({ handleMapClick }),
    [active, currentQuery, onResults, onRectangle, onPreview, onError, onToggle],
  );

  function handleToggleClick() {
    setCorner(null); // a fresh session never inherits a stale corner A
    onPreview(null); // …nor a stale dashed preview
    onToggle();
  }

  return (
    <div style={{ display: "flex", gap: "var(--space-2xs)", alignItems: "center", flexWrap: "wrap" }}>
      <button
        type="button"
        className="button button--ghost"
        aria-pressed={active}
        onClick={handleToggleClick}
      >
        Draw area
      </button>
      {active && (
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
    </div>
  );
}
