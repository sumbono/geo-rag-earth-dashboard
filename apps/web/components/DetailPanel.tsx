"use client";

import { useState, type CSSProperties } from "react";
import ScoreBarChart from "./ScoreBarChart";
import type { SearchResult } from "../lib/types";

export interface DetailPanelProps {
  /** The picked hit — thumb, bbox and metadata come straight from it. */
  tile: SearchResult;
  onClose: () => void;
  /** All ranked hits for the embedded chart; defaults to just `tile`. */
  results?: SearchResult[];
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
  padding: "4px 10px",
  borderRadius: 999,
  border: "1px solid var(--border, #d7e0e8)",
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
}: DetailPanelProps) {
  const [falseColor, setFalseColor] = useState(false);
  const chartResults = results ?? [tile];
  const thumbSrc = falseColor ? `${tile.thumb_url}?fc=1` : tile.thumb_url;

  return (
    <section
      aria-label="Tile details"
      className="detail-panel"
      style={{
        background: "var(--surface, #ffffff)",
        border: "1px solid var(--border, #d7e0e8)",
        borderRadius: 14,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
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
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          style={{
            border: "1px solid var(--border, #d7e0e8)",
            borderRadius: 8,
            background: "transparent",
            cursor: "pointer",
            font: "inherit",
            lineHeight: 1,
            padding: "4px 10px",
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
              borderRadius: 8,
              display: "block",
              background: "#e1e8ee",
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
                background: falseColor ? "transparent" : "var(--accent, #0b6f8f)",
                color: falseColor ? "inherit" : "#ffffff",
                borderColor: falseColor
                  ? "var(--border, #d7e0e8)"
                  : "var(--accent, #0b6f8f)",
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
                background: falseColor ? "var(--accent, #0b6f8f)" : "transparent",
                color: falseColor ? "#ffffff" : "inherit",
                borderColor: falseColor
                  ? "var(--accent, #0b6f8f)"
                  : "var(--border, #d7e0e8)",
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
          <dt style={{ color: "var(--ink-soft, #4a5b6a)", fontWeight: 600 }}>
            Captured
          </dt>
          <dd style={{ margin: 0 }}>{tile.captured_at}</dd>
          <dt style={{ color: "var(--ink-soft, #4a5b6a)", fontWeight: 600 }}>
            Bounding box
          </dt>
          <dd style={{ margin: 0 }}>{formatBbox(tile.bbox)}</dd>
          <dt style={{ color: "var(--ink-soft, #4a5b6a)", fontWeight: 600 }}>
            Score
          </dt>
          <dd style={{ margin: 0 }}>{tile.score.toFixed(2)}</dd>
        </dl>
      </div>

      <ScoreBarChart results={chartResults} selectedId={tile.id} />
    </section>
  );
}
