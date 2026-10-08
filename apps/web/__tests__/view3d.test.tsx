/**
 * Task 20 — Three.js score-elevated point view + Map | 3D | Telemetry tabs.
 *
 * three.js' WebGLRenderer needs a real GL context jsdom cannot provide, so
 * `three` and OrbitControls are mocked wholesale; View3D drives all of them,
 * so every projection / height / color / dispose assertion still runs against
 * the real component. The WebGL availability gate is exercised through the
 * brief's stub of `HTMLCanvasElement.prototype.getContext`. maplibre-gl is
 * mocked the same way as the other dashboard suites (the Map tab renders
 * first by default).
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DashboardPage from "../app/dashboard/page";
import View3D from "../components/View3D";
import type { SearchResult } from "../lib/types";

const hoisted = vi.hoisted(() => {
  class MockColor {
    r: number;
    g: number;
    b: number;
    constructor(r = 1, g = 1, b = 1) {
      this.r = r;
      this.g = g;
      this.b = b;
    }
  }

  class MockGeometry {
    dispose = vi.fn();
  }

  class MockMaterial {
    color: InstanceType<typeof MockColor>;
    constructor(options: { color?: InstanceType<typeof MockColor> } = {}) {
      this.color = options.color ?? new MockColor();
    }
    dispose = vi.fn();
  }

  class MockMesh {
    geometry: InstanceType<typeof MockGeometry>;
    material: InstanceType<typeof MockMaterial>;
    scale = { set: vi.fn() };
    position = {
      x: 0,
      y: 0,
      z: 0,
      set: (x: number, y: number, z: number) => {
        this.position.x = x;
        this.position.y = y;
        this.position.z = z;
      },
    };
    constructor(
      geometry: InstanceType<typeof MockGeometry>,
      material: InstanceType<typeof MockMaterial>,
    ) {
      this.geometry = geometry;
      this.material = material;
    }
  }

  class MockScene {
    children: InstanceType<typeof MockMesh>[] = [];
    add = vi.fn((object: InstanceType<typeof MockMesh>) => {
      this.children.push(object);
    });
    remove = vi.fn((object: InstanceType<typeof MockMesh>) => {
      const index = this.children.indexOf(object);
      if (index >= 0) this.children.splice(index, 1);
    });
    constructor() {
      scenes.push(this);
    }
  }

  class MockCamera {
    aspect = 1;
    position = { set: vi.fn() };
    lookAt = vi.fn();
    updateProjectionMatrix = vi.fn();
    constructor() {
      cameras.push(this);
    }
  }

  class MockRenderer {
    domElement: HTMLCanvasElement;
    dispose = vi.fn();
    render = vi.fn();
    setSize = vi.fn();
    setPixelRatio = vi.fn();
    constructor(options: { canvas: HTMLCanvasElement }) {
      if (flags.rendererThrow) {
        throw new Error("Error creating WebGL context.");
      }
      this.domElement = options.canvas;
      renderers.push(this);
    }
  }

  class MockControls {
    dispose = vi.fn();
    update = vi.fn();
    target = { set: vi.fn() };
    constructor(_camera: unknown, _domElement: unknown) {
      controls.push(this);
    }
  }

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
      mapInstances.push(this);
    }
  }

  class MockPopup {
    setLngLat = vi.fn((): unknown => this);
    setHTML = vi.fn((): unknown => this);
    setDOMContent = vi.fn((): unknown => this);
    addTo = vi.fn((): unknown => this);
    remove = vi.fn();
  }

  const renderers: InstanceType<typeof MockRenderer>[] = [];
  const scenes: InstanceType<typeof MockScene>[] = [];
  const cameras: InstanceType<typeof MockCamera>[] = [];
  const controls: InstanceType<typeof MockControls>[] = [];
  const mapInstances: InstanceType<typeof MockMap>[] = [];
  const flags = { rendererThrow: false };

  return {
    MockColor,
    MockGeometry,
    MockMaterial,
    MockMesh,
    MockScene,
    MockCamera,
    MockRenderer,
    MockControls,
    MockMap,
    MockPopup,
    renderers,
    scenes,
    cameras,
    controls,
    mapInstances,
    flags,
  };
});

vi.mock("three", () => ({
  Color: hoisted.MockColor,
  Mesh: hoisted.MockMesh,
  MeshBasicMaterial: hoisted.MockMaterial,
  PerspectiveCamera: hoisted.MockCamera,
  Scene: hoisted.MockScene,
  SphereGeometry: hoisted.MockGeometry,
  WebGLRenderer: hoisted.MockRenderer,
}));

vi.mock("three/examples/jsm/controls/OrbitControls.js", () => ({
  OrbitControls: hoisted.MockControls,
}));

vi.mock("maplibre-gl", () => ({
  default: { Map: hoisted.MockMap, Popup: hoisted.MockPopup },
  Map: hoisted.MockMap,
  Popup: hoisted.MockPopup,
  setWorkerUrl: vi.fn(), // R13(b): Map.tsx pins the worker URL at import time
}));

/** Ring-0 centroids: tile-1 → (38.05, 21.05), tile-2 → (40.1, 23.1). */
const sampleResults: SearchResult[] = [
  {
    id: "tile-1",
    thumb_url: "/api/thumbs/tile-1",
    bbox: [
      [
        [38, 21],
        [38.1, 21],
        [38.1, 21.1],
        [38, 21.1],
        [38, 21],
      ],
    ],
    score: 0.87654,
    captured_at: "2024-05-01T12:34:56Z",
  },
  {
    id: "tile-2",
    thumb_url: "/api/thumbs/tile-2",
    bbox: [
      [
        [40, 23],
        [40.2, 23],
        [40.2, 23.2],
        [40, 23.2],
        [40, 23],
      ],
    ],
    score: 0.4321,
    captured_at: "2023-11-20T08:00:00Z",
  },
];

/** Set to `null` in a test to make context creation fail. */
let getContextResult: object | null;

/** Shadow `clientWidth`/`clientHeight` on every div so View3D's container
 *  reports a controllable size (jsdom normally reports 0). Removed in
 *  afterEach via `Reflect.deleteProperty`. */
function stubContainerSize(size: { width: number; height: number }) {
  Object.defineProperty(HTMLDivElement.prototype, "clientWidth", {
    configurable: true,
    get: () => size.width,
  });
  Object.defineProperty(HTMLDivElement.prototype, "clientHeight", {
    configurable: true,
    get: () => size.height,
  });
}

let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;

/** Telemetry tab mounts a chart that fetches on mount (Task 21) — stub an
 *  empty window so no real request escapes and the tab renders "No telemetry". */
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ points: [], count: 0 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);

  // Brief's jsdom stub: jsdom has no WebGL, so both the availability probe
  // and anything else calling getContext gets this controlled answer.
  getContextResult = {};
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    (type: string) =>
      type === "webgl" || type === "webgl2"
        ? (getContextResult as never)
        : null,
  );
  // jsdom does not define WebGLRenderingContext — the success paths need it.
  Object.defineProperty(window, "WebGLRenderingContext", {
    configurable: true,
    writable: true,
    value: function WebGLRenderingContext() {},
  });

  hoisted.renderers.length = 0;
  hoisted.scenes.length = 0;
  hoisted.cameras.length = 0;
  hoisted.controls.length = 0;
  hoisted.mapInstances.length = 0;
  hoisted.flags.rendererThrow = false;
});

afterEach(() => {
  // Size stubs first so a failed assertion below cannot leak them.
  Reflect.deleteProperty(HTMLDivElement.prototype, "clientWidth");
  Reflect.deleteProperty(HTMLDivElement.prototype, "clientHeight");

  // Collect before restoring so a failure still cleans up the spies.
  const errors = consoleError.mock.calls.map((args: unknown[]) =>
    String(args[0]),
  );
  const warns = consoleWarn.mock.calls.map((args: unknown[]) =>
    String(args[0]),
  );
  consoleError.mockRestore();
  consoleWarn.mockRestore();
  expect(errors).toEqual([]);
  expect(warns).toEqual([]);

  vi.unstubAllGlobals();
  fetchMock.mockReset();
  vi.restoreAllMocks();
  delete (window as { WebGLRenderingContext?: unknown }).WebGLRenderingContext;
});

describe("View3D", () => {
  it("renders a canvas with one mesh per result: projected x/z, height = score x 20, blue-to-yellow color", () => {
    const { container } = render(<View3D results={sampleResults} />);

    const canvas = container.querySelector("canvas");
    expect(canvas).toBeInTheDocument();
    expect(hoisted.renderers).toHaveLength(1);
    expect(hoisted.renderers[0].domElement).toBe(canvas);

    // Scene at origin of the projection, one camera, orbit-style controls.
    expect(hoisted.scenes).toHaveLength(1);
    expect(hoisted.controls).toHaveLength(1);
    const meshes = hoisted.scenes[0].children;
    expect(meshes).toHaveLength(2);

    // Scale: max lon/lat offset from the Red Sea center (39, 22) is 1.1
    // (tile-2), so 1.1 degrees maps to 50 units → scale ≈ 45.4545.
    const scale = 50 / 1.1;
    const [first, second] = meshes;

    // tile-1 centroid (38.05, 21.05), score 0.87654.
    expect(first.position.x).toBeCloseTo((38.05 - 39) * scale, 4);
    expect(first.position.z).toBeCloseTo((21.05 - 22) * scale, 4);
    expect(first.position.y).toBeCloseTo(0.87654 * 20, 6);
    // Blue → yellow ramp: t=score → rgb(t, t, 1-t).
    expect(first.material.color.r).toBeCloseTo(0.87654, 6);
    expect(first.material.color.g).toBeCloseTo(0.87654, 6);
    expect(first.material.color.b).toBeCloseTo(1 - 0.87654, 6);

    // tile-2 centroid (40.1, 23.1), score 0.4321.
    expect(second.position.x).toBeCloseTo((40.1 - 39) * scale, 4);
    expect(second.position.z).toBeCloseTo((23.1 - 22) * scale, 4);
    expect(second.position.y).toBeCloseTo(0.4321 * 20, 6);
    expect(second.material.color.r).toBeCloseTo(0.4321, 6);
    expect(second.material.color.b).toBeCloseTo(1 - 0.4321, 6);

    // Everything stays inside the ~100-unit scene.
    for (const mesh of meshes) {
      expect(Math.abs(mesh.position.x)).toBeLessThanOrEqual(50);
      expect(Math.abs(mesh.position.z)).toBeLessThanOrEqual(50);
    }
  });

  it("rebuilds only the meshes when results change, disposing the old geometry and material", () => {
    const { rerender } = render(<View3D results={sampleResults} />);
    const [oldFirst, oldSecond] = hoisted.scenes[0].children;
    const rendererBefore = hoisted.renderers[0];

    rerender(<View3D results={[sampleResults[0]]} />);

    // Scene/renderer/camera survive (orbit state intact); the markers are
    // rebuilt and the previous geometry/materials are all disposed.
    expect(hoisted.scenes).toHaveLength(1);
    expect(hoisted.renderers[0]).toBe(rendererBefore);
    expect(hoisted.scenes[0].children).toHaveLength(1);
    expect(hoisted.scenes[0].children[0]).not.toBe(oldFirst);
    for (const old of [oldFirst, oldSecond]) {
      expect(hoisted.scenes[0].remove).toHaveBeenCalledWith(old);
      expect(old.geometry.dispose).toHaveBeenCalledTimes(1);
      expect(old.material.dispose).toHaveBeenCalledTimes(1);
    }
  });

  it("scales and accent-colors only the hovered point (cross-highlight)", () => {
    render(<View3D results={sampleResults} hoveredId="tile-1" />);

    const [first, second] = hoisted.scenes[0].children;
    // Hovered: ×1.4 scale + brand accent (#0b6f8f).
    expect(first.scale.set).toHaveBeenCalledWith(1.4, 1.4, 1.4);
    expect(first.material.color.r).toBeCloseTo(0x0b / 255, 6);
    expect(first.material.color.g).toBeCloseTo(0x6f / 255, 6);
    expect(first.material.color.b).toBeCloseTo(0x8f / 255, 6);
    // Everyone else keeps the score-ramp size and color.
    expect(second.scale.set).not.toHaveBeenCalled();
    expect(second.material.color.r).toBeCloseTo(0.4321, 6);
    expect(second.material.color.b).toBeCloseTo(1 - 0.4321, 6);
  });

  it("falls back to a 3D unavailable message when WebGLRenderingContext is missing", () => {
    delete (window as { WebGLRenderingContext?: unknown })
      .WebGLRenderingContext;

    const { container } = render(<View3D results={sampleResults} />);

    expect(container).toHaveTextContent("3D unavailable");
    expect(container.querySelector("canvas")).toBeNull();
    expect(hoisted.renderers).toHaveLength(0);
  });

  it("falls back to a 3D unavailable message when context creation fails", () => {
    getContextResult = null;

    const { container } = render(<View3D results={sampleResults} />);

    expect(container).toHaveTextContent("3D unavailable");
    expect(container.querySelector("canvas")).toBeNull();
    expect(hoisted.renderers).toHaveLength(0);
  });

  it("falls back to a 3D unavailable message when the WebGLRenderer constructor throws", () => {
    hoisted.flags.rendererThrow = true;

    const { container } = render(<View3D results={sampleResults} />);

    expect(container).toHaveTextContent("3D unavailable");
    expect(container.querySelector("canvas")).toBeNull();
    expect(hoisted.renderers).toHaveLength(0);
  });

  it("sizes the drawing buffer to the container and matches the camera aspect on init", () => {
    stubContainerSize({ width: 900, height: 600 });

    render(<View3D results={sampleResults} />);

    const renderer = hoisted.renderers[0];
    const camera = hoisted.cameras[0];
    expect(renderer.setSize).toHaveBeenCalledWith(900, 600, false);
    expect(renderer.setPixelRatio).toHaveBeenCalledWith(
      Math.min(window.devicePixelRatio || 1, 2),
    );
    // The review fix: aspect follows the (non-square) container, not 1.
    expect(camera.aspect).toBeCloseTo(900 / 600, 6);
    expect(camera.updateProjectionMatrix).toHaveBeenCalledTimes(1);
  });

  it("re-applies size and camera aspect when the window (and container) resizes", () => {
    const size = { width: 900, height: 600 };
    stubContainerSize(size);

    render(<View3D results={sampleResults} />);
    const renderer = hoisted.renderers[0];
    const camera = hoisted.cameras[0];
    expect(renderer.setSize).toHaveBeenCalledTimes(1);

    size.width = 1500; // the container grew with the window
    fireEvent.resize(window);

    expect(renderer.setSize).toHaveBeenLastCalledWith(1500, 600, false);
    expect(camera.aspect).toBeCloseTo(1500 / 600, 6);
    expect(camera.updateProjectionMatrix).toHaveBeenCalledTimes(2);
  });

  it("cancels the animation frame and disposes renderer, controls, geometry and material on unmount", () => {
    const cancel = vi.spyOn(window, "cancelAnimationFrame");
    const { container, unmount } = render(<View3D results={sampleResults} />);

    const renderer = hoisted.renderers[0];
    const controls = hoisted.controls[0];
    const [mesh] = hoisted.scenes[0].children;

    unmount();

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
    expect(controls.dispose).toHaveBeenCalledTimes(1);
    expect(mesh.geometry.dispose).toHaveBeenCalledTimes(1);
    expect(mesh.material.dispose).toHaveBeenCalledTimes(1);
    expect(container.querySelector("canvas")).toBeNull();
  });
});

describe("dashboard tabs", () => {
  it("starts on Map, switches to 3D (canvas) and Telemetry (chart), and back", async () => {
    render(<DashboardPage />);

    // Map is the default tab: the MapLibre mock is live, no WebGL canvas yet.
    expect(screen.getByRole("button", { name: "Map" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("button", { name: "OSM streets" }),
    ).toBeInTheDocument();
    expect(document.querySelector("canvas")).toBeNull();

    // 3D tab: the View3D canvas appears (loaded via next/dynamic ssr:false)
    // and the map unmounts.
    fireEvent.click(screen.getByRole("button", { name: "3D" }));
    expect(screen.getByRole("button", { name: "3D" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Map" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await waitFor(() =>
      expect(document.querySelector("canvas")).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: "OSM streets" }),
    ).not.toBeInTheDocument();

    // Telemetry tab: the Task 21 chart (stubbed fetch → empty window).
    fireEvent.click(screen.getByRole("button", { name: "Telemetry" }));
    expect(screen.getByRole("button", { name: "Telemetry" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(await screen.findByText("No telemetry")).toBeInTheDocument();
    expect(document.querySelector("canvas")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "OSM streets" }),
    ).not.toBeInTheDocument();

    // Back to Map: the mock map remounts.
    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    expect(
      screen.getByRole("button", { name: "OSM streets" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Map" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(document.querySelector("canvas")).toBeNull();
  });

  it("unmounts the 3D scene (renderer disposed) when leaving the 3D tab", async () => {
    render(<DashboardPage />);

    fireEvent.click(screen.getByRole("button", { name: "3D" }));
    await waitFor(() =>
      expect(document.querySelector("canvas")).toBeInTheDocument(),
    );
    expect(hoisted.renderers).toHaveLength(1);
    const renderer = hoisted.renderers[0];

    fireEvent.click(screen.getByRole("button", { name: "Telemetry" }));

    expect(renderer.dispose).toHaveBeenCalledTimes(1);
    expect(document.querySelector("canvas")).toBeNull();
  });
});
