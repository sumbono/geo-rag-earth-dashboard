"use client";

import { useEffect, useRef, useState } from "react";
import {
  Color,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { SearchResult } from "../lib/types";

/** Lon/lat origin of the projection — the Red Sea scene center (as in Map). */
const CENTER_LON = 39;
const CENTER_LAT = 22;
/** The largest lon/lat offset from the center maps to ±HALF_EXTENT units,
 *  so the whole spread fits a ~100-unit scene. */
const HALF_EXTENT = 50;
/** Point height above the ground plane: y = score × 20. */
const HEIGHT_PER_SCORE = 20;
/** Marker radius in scene units. */
const MARKER_RADIUS = 1.6;
/** Below this the result set has no spread; keep a sane unit scale. */
const SPREAD_EPSILON = 1e-9;

/** Centroid of a GeoJSON Polygon's outer ring (closing duplicate dropped) —
 *  same convention as the Map's result markers. */
function ringCentroid(ring: number[][]): [number, number] {
  const closed =
    ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1];
  const points = closed ? ring.slice(0, -1) : ring;
  let sumLng = 0;
  let sumLat = 0;
  for (const point of points) {
    sumLng += point[0];
    sumLat += point[1];
  }
  const count = Math.max(points.length, 1);
  return [sumLng / count, sumLat / count];
}

/** Degrees-per-unit scale: max offset from the center → HALF_EXTENT. */
function projectionScale(results: SearchResult[]): number {
  let maxOffset = 0;
  for (const result of results) {
    const [lng, lat] = ringCentroid(result.bbox[0]);
    maxOffset = Math.max(
      maxOffset,
      Math.abs(lng - CENTER_LON),
      Math.abs(lat - CENTER_LAT),
    );
  }
  return maxOffset > SPREAD_EPSILON ? HALF_EXTENT / maxOffset : 1;
}

export interface View3DProps {
  results: SearchResult[];
}

/**
 * WebGL 3D view of the search results (Task 20).
 *
 * One sphere per result at (lon → x, lat → z) projected around the Red Sea
 * center (39, 22) and scaled so the spread fits a ~100-unit scene; height is
 * the score × 20 and the color ramps blue → yellow with the score. Drag
 * rotates the camera via OrbitControls; the animation loop, renderer and all
 * geometry/materials are disposed on unmount.
 *
 * SSR/fallback: setup runs only in an effect. If `WebGLRenderingContext` is
 * missing or context creation fails, a `<p>3D unavailable</p>` renders
 * instead of crashing. The page imports this component with
 * `next/dynamic(..., { ssr: false })`, so three.js never loads during SSR.
 */
export default function View3D({ results }: View3DProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  // One-time scene setup: availability gate → renderer/camera/controls →
  // RAF loop. Torn down wholesale on unmount.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof window === "undefined") return;

    if (typeof window.WebGLRenderingContext === "undefined") {
      setUnavailable(true);
      return;
    }
    const probe = document.createElement("canvas");
    let context: RenderingContext | null = null;
    try {
      context = probe.getContext("webgl2") ?? probe.getContext("webgl");
    } catch {
      context = null;
    }
    if (context === null) {
      setUnavailable(true);
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    container.appendChild(canvas);

    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ canvas, antialias: true });
    } catch {
      canvas.remove();
      setUnavailable(true);
      return;
    }

    const scene = new Scene();
    const camera = new PerspectiveCamera(50, 1, 0.1, 1000);
    camera.position.set(0, 55, 95);
    camera.lookAt(0, 10, 0);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 10, 0);
    renderer.setSize(
      container.clientWidth || 640,
      container.clientHeight || 480,
      false,
    );

    sceneRef.current = scene;

    let frameId = requestAnimationFrame(function tick() {
      renderer.render(scene, camera);
      controls.update();
      frameId = requestAnimationFrame(tick);
    });

    return () => {
      cancelAnimationFrame(frameId);
      controls.dispose();
      renderer.dispose();
      sceneRef.current = null;
      canvas.remove();
    };
  }, []);

  // Rebuild the markers when the results change — the camera, renderer and
  // orbit state survive; the old geometry/materials are disposed.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const scale = projectionScale(results);
    const meshes = results.map((result) => {
      const [lng, lat] = ringCentroid(result.bbox[0]);
      const score = Math.min(Math.max(result.score, 0), 1);
      // Blue (0, 0, 1) → yellow (1, 1, 0), t = score.
      const material = new MeshBasicMaterial({
        color: new Color(score, score, 1 - score),
      });
      const mesh = new Mesh(new SphereGeometry(MARKER_RADIUS), material);
      mesh.position.set(
        (lng - CENTER_LON) * scale,
        result.score * HEIGHT_PER_SCORE,
        (lat - CENTER_LAT) * scale,
      );
      scene.add(mesh);
      return mesh;
    });

    return () => {
      for (const mesh of meshes) {
        scene.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
    };
  }, [results]);

  if (unavailable) {
    return <p>3D unavailable</p>;
  }
  return (
    <div
      ref={containerRef}
      style={{ height: "min(60vh, 560px)", minHeight: 320 }}
    />
  );
}
