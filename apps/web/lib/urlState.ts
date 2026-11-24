/**
 * Shareable dashboard URL state (P0/P1 Task 5): `?q=&bbox=w,s,e,n&tile=`.
 *
 * Pure encode/parse — tolerant by contract: bad arity, non-finite numbers or
 * malformed percent-encoding drop just that part, never throw. `replaceUrlState`
 * writes with history.replaceState only (Back must not walk search states);
 * an empty build falls back to the bare pathname so clearing state clears the
 * query string too.
 */

export interface UrlState {
  // null is accepted (and dropped) alongside absent — the plan's contract is
  // "drops empty/null", and callers hold `Bbox | null` / `string | null` state.
  q?: string | null;
  bbox?: [[number, number], [number, number]] | null;
  tile?: string | null;
}

function finitePair(w: number, s: number, e: number, n: number): [[number, number], [number, number]] | null {
  if (![w, s, e, n].every(Number.isFinite)) return null;
  return [
    [w, s],
    [e, n],
  ];
}

export function buildUrlState(state: UrlState): string {
  const params = new URLSearchParams();
  if (state.q) params.set("q", state.q);
  if (state.bbox) {
    const [[w, s], [e, n]] = state.bbox;
    if ([w, s, e, n].every(Number.isFinite)) params.set("bbox", `${w},${s},${e},${n}`);
  }
  if (state.tile) params.set("tile", state.tile);
  // URLSearchParams percent-encodes commas (%2C); decode them back so shared
  // links stay human-readable (`bbox=38,21,40,23` per the plan contract).
  // A comma is legal unencoded in a query value and round-trips identically
  // through URLSearchParams on parse.
  const qs = params.toString().replace(/%2C/gi, ",");
  return qs ? `?${qs}` : "";
}

export function parseUrlState(search: string): UrlState {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  } catch {
    return {}; // malformed input — tolerate, never throw
  }
  const out: UrlState = {};

  const q = params.get("q");
  if (q) out.q = q;

  const bbox = params.get("bbox");
  if (bbox) {
    const parts = bbox.split(",").map(Number);
    if (parts.length === 4) {
      const pair = finitePair(parts[0], parts[1], parts[2], parts[3]);
      if (pair) out.bbox = pair;
    }
  }

  const tile = params.get("tile");
  if (tile) out.tile = tile;

  return out;
}

export function replaceUrlState(state: UrlState): void {
  const next = buildUrlState(state);
  window.history.replaceState(null, "", next || window.location.pathname);
}
