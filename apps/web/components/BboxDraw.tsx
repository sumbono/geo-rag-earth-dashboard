"use client";

import { useEffect, useImperativeHandle, useState, type Ref } from "react";
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
  /** Anything `apiFetch` throws — surfaced by the page as its alert. */
  onError: (error: unknown) => void;
  ref?: Ref<BboxDrawHandle>;
}

/**
 * Two-click bbox draw search (Task 19).
 *
 * The "Draw area" toggle arms the mode; the page forwards map clicks here
 * while it is armed. Click 1 records corner A (temp point/line + coordinates
 * in the status strip), click 2 normalizes the pair into an ordered
 * `[[w,s],[e,n]]`, immediately POSTs it once to `/api/search/bbox` with
 * `q: currentQuery || null`, then lifts the hits and the box to the page —
 * which merges them into the panel and renders the rectangle. Esc aborts the
 * in-progress rectangle without any request (the tool stays armed); toggling
 * the button off mid-draw also drops corner A. The toggle disarms itself
 * once a draw completes.
 */
export default function BboxDraw({
  active,
  onToggle,
  currentQuery,
  onResults,
  onRectangle,
  onError,
  ref,
}: BboxDrawProps) {
  const [corner, setCorner] = useState<[number, number] | null>(null);

  // Esc cancels the in-progress rectangle: temp visual cleared, no request.
  useEffect(() => {
    if (!active) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setCorner(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active]);

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
      onRectangle(bbox);
    } catch (error) {
      onError(error);
    }
  }

  function handleMapClick(lonLat: [number, number]) {
    if (!active) return;
    if (corner === null) {
      setCorner(lonLat);
      return;
    }
    // Corner B: normalize so the box is always [[w,s],[e,n]] (w<e, s<n).
    const bbox: Bbox = [
      [Math.min(corner[0], lonLat[0]), Math.min(corner[1], lonLat[1])],
      [Math.max(corner[0], lonLat[0]), Math.max(corner[1], lonLat[1])],
    ];
    setCorner(null);
    onToggle(); // one draw per arm — disarm before the request leaves
    void runSearch(bbox);
  }

  useImperativeHandle(
    ref,
    () => ({ handleMapClick }),
    [active, corner, currentQuery, onResults, onRectangle, onError, onToggle],
  );

  function handleToggleClick() {
    setCorner(null); // a fresh session never inherits a stale corner A
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
