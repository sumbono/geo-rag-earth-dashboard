import { FlatCompat } from "@eslint/eslintrc";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: __dirname });

/**
 * Task 22 — real ESLint config (flat, ESLint 9) so CI's lint step is not a
 * vacuous green check. Next's own presets (`next/core-web-vitals` +
 * `next/typescript`) via FlatCompat; build output and generated files are
 * ignored. `next build` keeps `eslint.ignoreDuringBuilds` untouched — lint
 * runs as its own CI step so failures name themselves.
 */
const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "test-results/**",
      "playwright-report/**",
      "coverage/**",
      "next-env.d.ts",
      // R13(b): vendored maplibre worker bundle (synced by
      // scripts/sync-maplibre-worker.mjs) — minified third-party code.
      "public/**",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // vi.hoisted MapLibre doubles are structurally `any` by design; in tests
    // that stays a visible warning, never a silent exemption. Shipped code
    // (app/, components/, lib/) keeps the preset's error severity.
    files: ["__tests__/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
];

export default config;
