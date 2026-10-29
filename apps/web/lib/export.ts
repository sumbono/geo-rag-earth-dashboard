import type { SearchResult } from "./types";

/** Current results as a GeoJSON FeatureCollection (RFC 7946): one Polygon
 *  feature per hit, geometry = the API's closed ring, properties = the
 *  inspectable fields. Pretty-printed so a saved file diffs sensibly. */
export function resultsToGeoJSON(results: SearchResult[]): string {
  return JSON.stringify(
    {
      type: "FeatureCollection",
      features: results.map((r) => ({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: r.bbox },
        properties: {
          id: r.id,
          score: r.score,
          captured_at: r.captured_at,
          thumb_url: r.thumb_url,
        },
      })),
    },
    null,
    2,
  );
}

export function resultsToCSV(results: SearchResult[]): string {
  const rows = results.map((r) => `${r.id},${r.score},${r.captured_at}`);
  return ["id,score,captured_at", ...rows].join("\n");
}

export function downloadText(filename: string, mime: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
