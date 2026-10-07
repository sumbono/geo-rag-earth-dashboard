/**
 * Task 21 — D3 telemetry timeseries panel.
 *
 * fetch is stubbed wholesale; the real TelemetryChart runs against it so the
 * default-buoy query, the D3 line path, and the loading / empty / error states
 * are all exercised end to end. The dashboard tab wiring is asserted through
 * the real DashboardPage (maplibre mocked the same way as the other suites).
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DashboardPage from "../app/dashboard/page";
import TelemetryChart from "../components/TelemetryChart";
import type { TelemetryPoint } from "../lib/types";

const hoisted = vi.hoisted(() => {
  class MockMap {
    options: unknown;
    on = vi.fn();
    once = vi.fn();
    remove = vi.fn();
    isStyleLoaded = vi.fn(() => true);
    getSource = vi.fn(() => ({ setData: vi.fn() }));
    setLayoutProperty = vi.fn();
    flyTo = vi.fn();
    constructor(options: unknown) {
      this.options = options;
    }
  }

  class MockPopup {
    setLngLat = vi.fn((): unknown => this);
    setHTML = vi.fn((): unknown => this);
    addTo = vi.fn((): unknown => this);
  }

  return { MockMap, MockPopup };
});

vi.mock("maplibre-gl", () => ({
  default: { Map: hoisted.MockMap, Popup: hoisted.MockPopup },
  Map: hoisted.MockMap,
  Popup: hoisted.MockPopup,
}));

const fetchMock = vi.fn<typeof fetch>();

function stubFetch(status: number, body: unknown) {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
}

/** Three UTC-ISO samples on one day — enough for a real line segment. */
const threePoints: TelemetryPoint[] = [
  { ts: "2026-10-06T10:00:00Z", value: 12.5 },
  { ts: "2026-10-06T14:00:00Z", value: 18.25 },
  { ts: "2026-10-06T18:00:00Z", value: 9 },
];

let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  // Collect before restoring so a failure still cleans up the spies.
  const errors = consoleError.mock.calls.map((args: unknown[]) => String(args[0]));
  const warns = consoleWarn.mock.calls.map((args: unknown[]) => String(args[0]));
  consoleError.mockRestore();
  consoleWarn.mockRestore();
  expect(errors).toEqual([]);
  expect(warns).toEqual([]);

  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("TelemetryChart", () => {
  it("fetches the default buoy's 24h window and draws one line path", async () => {
    stubFetch(200, { points: threePoints, count: 3 });
    const { container } = render(<TelemetryChart />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/telemetry/query?buoy_id=buoy-rs-1&hours=24");
    expect(init?.credentials).toBe("include");

    const paths = container.querySelectorAll("path");
    expect(paths).toHaveLength(1);
    expect(paths[0].getAttribute("d")).toBeTruthy();
    expect(paths[0].getAttribute("d")!.length).toBeGreaterThan(10);
  });

  it("labels the time axis in UTC via d3.utcFormat", async () => {
    stubFetch(200, { points: threePoints, count: 3 });
    const { container } = render(<TelemetryChart />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await screen.findByRole("img");

    // "<day> <Mon> <HH:MM>" — e.g. "06 Oct 10:00", always UTC regardless of
    // the host timezone.
    const utcLabel = /\d{2} [A-Z][a-z]{2} \d{2}:\d{2}/;
    const labels = [...container.querySelectorAll("text")].map(
      (node) => node.textContent ?? "",
    );
    expect(labels.some((label) => utcLabel.test(label))).toBe(true);
  });

  it("shows the loading state while the query is in flight", () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    vi.stubGlobal("fetch", fetchMock);

    render(<TelemetryChart />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading telemetry");
    expect(containerHasNoSvg()).toBe(true);
  });

  it("shows 'No telemetry' when the window comes back empty", async () => {
    stubFetch(200, { points: [], count: 0 });
    render(<TelemetryChart />);

    expect(await screen.findByText("No telemetry")).toBeInTheDocument();
    expect(document.querySelector("svg")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces ApiError messages from a failed query", async () => {
    stubFetch(401, { detail: "Could not validate credentials" });
    render(<TelemetryChart />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not validate credentials",
    );
    expect(document.querySelector("svg")).toBeNull();
  });

  it("shows a friendly message for non-ApiError failures", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    render(<TelemetryChart />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Telemetry unavailable",
    );
  });

  it("refetches when the buoy selector changes", async () => {
    stubFetch(200, { points: threePoints, count: 3 });
    render(<TelemetryChart />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText("Buoy"), {
      target: { value: "buoy-rs-3" },
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(String(fetchMock.mock.calls[1][0])).toBe(
      "/api/telemetry/query?buoy_id=buoy-rs-3&hours=24",
    );
    // The selector offers all five Red Sea buoys.
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "buoy-rs-1",
      "buoy-rs-2",
      "buoy-rs-3",
      "buoy-rs-4",
      "buoy-rs-5",
    ]);
  });

  it("aborts the in-flight query on unmount (no late state update)", async () => {
    let receivedSignal: AbortSignal | undefined;
    fetchMock.mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          receivedSignal = init?.signal ?? undefined;
          receivedSignal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { unmount } = render(<TelemetryChart />);
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
    expect(receivedSignal!.aborted).toBe(false);

    unmount();
    expect(receivedSignal!.aborted).toBe(true);
  });
});

function containerHasNoSvg(): boolean {
  return document.querySelector("svg") === null;
}

describe("dashboard Telemetry tab", () => {
  it("renders TelemetryChart in place of the old placeholder", async () => {
    stubFetch(200, { points: [], count: 0 });
    render(<DashboardPage />);

    fireEvent.click(screen.getByRole("button", { name: "Telemetry" }));

    expect(await screen.findByText("No telemetry")).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "/api/telemetry/query?buoy_id=buoy-rs-1&hours=24",
    );
    // The old `<div>Telemetry</div>` placeholder is gone.
    expect(
      screen.queryByText("Telemetry", { selector: "div" }),
    ).not.toBeInTheDocument();
  });
});
