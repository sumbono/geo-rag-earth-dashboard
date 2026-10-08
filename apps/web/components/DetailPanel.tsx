"use client";

import { useEffect, useState, type CSSProperties } from "react";
import ScoreBarChart from "./ScoreBarChart";
import type { SearchResult } from "../lib/types";

export interface DetailPanelProps {
  /** The picked hit — thumb, bbox and metadata come straight from it. */
  tile: SearchResult;
  onClose: () => void;
  /** All ranked hits for the embedded chart; defaults to just `tile`. */
  results?: SearchResult[];
  /** Prev/next step through `results` (Task 9). Optional so existing renders
   *  without it stay valid (finding 13); the page wraps the index modulo
   *  `results.length`. Wired to the header buttons AND ArrowLeft/ArrowRight
   *  on `window` (listener removed on unmount). */
  onNavigate?: (delta: 1 | -1) => void;
}

/** Flatten every ring's points into an axis-aligned "W, S → E, N" string. */
function formatBbox(bbox: number[][][]): string {
  const points = bbox.flat().filter((point) => point.length >= 2);
  if (points.length === 0) return "Unavailable";
  const lngs = points.map((point) => point[0]);
  const lats = points.map((point) => point[1]);
  const west = Math.min(...lngs);
  const east = Math.max(...lngs);
  const south = Math.min(...lats);
  const north = Math.max(...lats);
  return `${west.toFixed(4)}, ${south.toFixed(4)} → ${east.toFixed(4)}, ${north.toFixed(4)}`;
}

const chipStyle: CSSProperties = {
  padding: "var(--space-3xs) var(--space-xs)",
  borderRadius: "var(--radius-control)",
  border: "1px solid var(--color-rule-2)",
  background: "transparent",
  cursor: "pointer",
  font: "inherit",
  fontSize: "0.85rem",
};

/**
 * Picked-tile detail (Task 18): larger thumbnail with a True color / False
 * color toggle (Option B — `thumb_url` ↔ `thumb_url + "?fc=1"`, cookie auth
 * makes the plain `<img>` work), bbox + captured_at text, an embedded score
 * chart over all results with this tile selected, and a close button that
 * hands control back via `onClose`.
 */
export default function DetailPanel({
  tile,
  onClose,
  results,
  onNavigate,
}: DetailPanelProps) {
  const [falseColor, setFalseColor] = useState(false);
  const chartResults = results ?? [tile];
  const thumbSrc = falseColor ? `${tile.thumb_url}?fc=1` : tile.thumb_url;

  // Arrow keys step through results while the panel is open (Task 9). The
  // listener lives here — the panel only mounts when a tile is selected, so
  // there is no "select from nothing" keyboard branch on the page (finding
  // 21). Skipped while typing in a field so editing text keeps its carets;
  // removed on unmount so a closed panel never navigates (finding 24's
  // cleanup pattern applied to the keydown listener).
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "ArrowRight") onNavigate?.(1);
      else if (event.key === "ArrowLeft") onNavigate?.(-1);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onNavigate]);

  return (
    <section
      aria-label="Tile details"
      className="detail-panel"
      style={{
        background: "var(--color-paper-2)",
        border: "var(--rule)",
        borderRadius: "var(--radius-card)",
        padding: "var(--space-sm)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-xs)",
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
        }}
      >
        <h2 style={{ margin: 0, fontSize: "1.05rem" }}>Tile details</h2>
        <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
          <button
            type="button"
            aria-label="Previous result"
            onClick={() => onNavigate?.(-1)}
            style={chipStyle}
          >
            ‹ Previous
          </button>
          <button
            type="button"
            aria-label="Next result"
            onClick={() => onNavigate?.(1)}
            style={chipStyle}
          >
            Next ›
          </button>
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          style={{
            border: "1px solid var(--color-rule-2)",
            borderRadius: "var(--radius-control)",
            background: "transparent",
            cursor: "pointer",
            font: "inherit",
            lineHeight: 1,
            padding: "var(--space-3xs) var(--space-xs)",
          }}
        >
          ×
        </button>
      </header>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 16,
          alignItems: "flex-start",
        }}
      >
        <figure style={{ margin: 0, flex: "1 1 240px", minWidth: 220 }}>
          <img
            src={thumbSrc}
            alt={`Thumbnail for ${tile.id}`}
            style={{
              width: "100%",
              maxWidth: 360,
              borderRadius: "var(--radius-card)",
              display: "block",
              background: "var(--color-rule)",
            }}
          />
          <div
            role="group"
            aria-label="Color mode"
            style={{ display: "flex", gap: 8, marginTop: 8 }}
          >
            <button
              type="button"
              aria-pressed={!falseColor}
              onClick={() => setFalseColor(false)}
              style={{
                ...chipStyle,
                background: falseColor ? "transparent" : "var(--color-accent)",
                color: falseColor ? "inherit" : "var(--color-accent-ink)",
                borderColor: falseColor
                  ? "var(--color-rule-2)"
                  : "var(--color-accent)",
              }}
            >
              True color
            </button>
            <button
              type="button"
              aria-pressed={falseColor}
              onClick={() => setFalseColor(true)}
              style={{
                ...chipStyle,
                background: falseColor ? "var(--color-accent)" : "transparent",
                color: falseColor ? "var(--color-accent-ink)" : "inherit",
                borderColor: falseColor
                  ? "var(--color-accent)"
                  : "var(--color-rule-2)",
              }}
            >
              False color
            </button>
          </div>
        </figure>

        <dl
          style={{
            margin: 0,
            flex: "1 1 220px",
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            gap: "6px 12px",
            fontSize: "0.92rem",
          }}
        >
          <dt style={{ color: "var(--color-ink-soft)", fontWeight: 600 }}>
            Captured
          </dt>
          <dd style={{ margin: 0 }}>{tile.captured_at}</dd>
          <dt style={{ color: "var(--color-ink-soft)", fontWeight: 600 }}>
            Bounding box
          </dt>
          <dd style={{ margin: 0 }}>{formatBbox(tile.bbox)}</dd>
          <dt style={{ color: "var(--color-ink-soft)", fontWeight: 600 }}>
            Score
          </dt>
          <dd style={{ margin: 0 }}>{tile.score.toFixed(2)}</dd>
        </dl>
      </div>

      <ScoreBarChart results={chartResults} selectedId={tile.id} />
    </section>
  );
}
