import { fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import BboxDraw, { type BboxDrawHandle } from "../components/BboxDraw";
import { type RefObject } from "react";

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
  const onPolygon = vi.fn();
  const onResults = vi.fn();
  const onError = vi.fn();
  const ref: RefObject<BboxDrawHandle | null> = { current: null };
  render(
    <BboxDraw ref={ref} active polygonMode onToggle={() => {}} onTogglePolygon={() => {}} currentQuery="water" onResults={onResults} onRectangle={() => {}} onPreview={() => {}} onPolygon={onPolygon} onError={onError} />,
  );
  return { ref, onPolygon, onResults, onError };
}

it("accumulates vertices and refuses to close with fewer than 3", () => {
  const { ref, onPolygon } = setup();
  ref.current!.handleMapClick([39.0, 21.0]);
  ref.current!.handleMapClick([39.1, 21.0]);
  fireEvent.keyDown(window, { key: "Enter" });
  expect(onPolygon).not.toHaveBeenCalled();
  ref.current!.handleMapClick([39.05, 21.1]);
  fireEvent.keyDown(window, { key: "Enter" });
  expect(onPolygon).toHaveBeenCalledWith([[39.0, 21.0], [39.1, 21.0], [39.05, 21.1]]);
});

it("POSTs /api/search/polygon with polygon and q, then lifts results", async () => {
  const { ref, onResults } = setup();
  ref.current!.handleMapClick([39.0, 21.0]);
  ref.current!.handleMapClick([39.1, 21.0]);
  ref.current!.handleMapClick([39.05, 21.1]);
  fireEvent.keyDown(window, { key: "Enter" });
  await waitFor(() => expect(onResults).toHaveBeenCalledTimes(1));
  expect(fetchMock).toHaveBeenCalledWith("/api/search/polygon", expect.objectContaining({
    method: "POST",
    body: JSON.stringify({ polygon: [[39, 21], [39.1, 21], [39.05, 21.1]], q: "water" }),
  }));
});

it("Esc clears vertices without sending", () => {
  const { ref, onPolygon } = setup();
  ref.current!.handleMapClick([39.0, 21.0]);
  ref.current!.handleMapClick([39.1, 21.0]);
  fireEvent.keyDown(window, { key: "Escape" });
  fireEvent.keyDown(window, { key: "Enter" });
  expect(onPolygon).not.toHaveBeenCalled();
});

it("double-click near the last vertex closes (no duplicate vertex appended)", () => {
  const { ref, onPolygon } = setup();
  ref.current!.handleMapClick([39.0, 21.0]);
  ref.current!.handleMapClick([39.1, 21.0]);
  ref.current!.handleMapClick([39.05, 21.1]);
  // second rapid click ~20ms later, 1e-7° from the last vertex → close, not append
  ref.current!.handleMapClick([39.05 + 1e-7, 21.1 + 1e-7]);
  expect(onPolygon).toHaveBeenCalledWith([[39.0, 21.0], [39.1, 21.0], [39.05, 21.1]]);
});
