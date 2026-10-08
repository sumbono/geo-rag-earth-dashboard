/**
 * Task 6 — live draw feedback (audit major #5, part 1).
 *
 * BboxDraw is rendered directly with a ref handle, so no maplibre mock is
 * needed here: these tests pin the callback contract (`onPreview` /
 * `onRectangle`) that the page forwards to the map's preview + persisted
 * layers — including the corner-B sequence (finding 8 as amended by R-6a):
 * preview(completed) → onRectangle(completed) → POST, with no same-tick
 * preview clear so the dashed box actually stays painted.
 */
import { fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import BboxDraw, { type BboxDrawHandle } from "../components/BboxDraw";
import { type RefObject } from "react";

// fetch harness per api.test.ts: stub globally, restore after each test
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ results: [] }), { status: 200, headers: { "Content-Type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function setup() {
  const onPreview = vi.fn();
  const onRectangle = vi.fn();
  const onResults = vi.fn();
  const onError = vi.fn();
  const ref: RefObject<BboxDrawHandle | null> = { current: null };
  render(
    <BboxDraw ref={ref} active onToggle={() => {}} currentQuery="" onResults={onResults} onRectangle={onRectangle} onPreview={onPreview} onError={onError} />,
  );
  return { ref, onPreview, onRectangle, onResults, onError };
}

it("click 1 previews the degenerate box; click 2 previews the completed box and hands off to onRectangle (preview persists)", () => {
  const { ref, onPreview, onRectangle } = setup();
  ref.current!.handleMapClick([39.0, 21.0]);
  expect(onPreview).toHaveBeenLastCalledWith([[39, 21], [39, 21]]);
  ref.current!.handleMapClick([39.2, 21.2]);
  // R-6a sequence at corner B: preview(completed) → onRectangle(completed) →
  // POST — NO same-tick preview clear, so the dashed box keeps painting
  // (stacked under the persisted rectangle) and survives a fetch error.
  expect(onPreview).toHaveBeenCalledWith([[39.0, 21.0], [39.2, 21.2]]);
  expect(onPreview).toHaveBeenLastCalledWith([[39.0, 21.0], [39.2, 21.2]]);
  expect(onRectangle).toHaveBeenCalledWith([[39.0, 21.0], [39.2, 21.2]]);
});

it("rectangle is emitted BEFORE the request resolves (visual-first)", async () => {
  const { ref, onRectangle, onResults } = setup();
  let resolveFetch!: (value: Response) => void;
  fetchMock.mockReturnValueOnce(new Promise((resolve) => { resolveFetch = resolve; }));
  ref.current!.handleMapClick([39.0, 21.0]);
  ref.current!.handleMapClick([39.2, 21.2]);
  expect(onRectangle).toHaveBeenCalledTimes(1);   // fired while fetch is pending
  expect(onResults).not.toHaveBeenCalled();
  resolveFetch(new Response(JSON.stringify({ results: [] }), { status: 200 }));
  await waitFor(() => expect(onResults).toHaveBeenCalledTimes(1));
});

it("Esc clears the preview", () => {
  const { ref, onPreview } = setup();
  ref.current!.handleMapClick([39.0, 21.0]);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(onPreview).toHaveBeenLastCalledWith(null);
});
