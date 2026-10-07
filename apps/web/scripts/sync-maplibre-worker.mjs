#!/usr/bin/env node
/**
 * R13(b): copy maplibre-gl's worker bundle into public/ so the app can pin
 * `setWorkerUrl("/maplibre-gl-worker.mjs")` instead of relying on maplibre's
 * `import.meta.url` default — webpack rewrites that to a build-time `file://`
 * path in the prod bundle, which makes maplibre resolve the worker URL to ""
 * (the page URL) and every GeoJSON source silently fails to render.
 *
 * Runs via the `predev` / `prebuild` npm hooks so the committed copy can never
 * go stale across maplibre-gl upgrades; the file is also committed so a bare
 * `next build` (hooks bypassed) still ships it.
 */
import { copyFileSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(webRoot, "node_modules", "maplibre-gl", "dist", "maplibre-gl-worker.mjs");
const dst = join(webRoot, "public", "maplibre-gl-worker.mjs");

if (!existsSync(src)) {
  console.error(`sync-maplibre-worker: missing ${src} — run \`npm install\` first`);
  process.exit(1);
}
copyFileSync(src, dst);
console.log(
  `sync-maplibre-worker: public/maplibre-gl-worker.mjs (${statSync(dst).size} bytes)`,
);
