import type { NextConfig } from "next";

/**
 * Single-origin proxy: the browser only ever talks to this server; `/api/*`
 * is rewritten to the FastAPI backend. Compose sets
 * `API_INTERNAL_URL=http://api:8000`; local dev falls back to localhost:8000.
 */
const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://localhost:8000";

/**
 * Spec §6 hardening checklist — static security headers on every route.
 *
 * CSP tuned against the running app (evidence from the rebuilt stack's
 * e2e: map tiles, 3D layer, login/search/telemetry all work, and no
 * `Refused to …` console violations):
 *
 * - `script-src 'self' 'unsafe-inline'`: Next's App Router hydrates through
 *   inline `<script>` tags baked into each HTML response (verified in the
 *   served page); a per-request nonce is impossible from static
 *   `next.config` headers, so `'unsafe-inline'` is required for the page to
 *   hydrate at all. `'unsafe-eval'` is deliberately ABSENT — the prod
 *   bundle (webpack runtime, maplibre-gl, d3) never calls `eval`, and the
 *   e2e asserts zero CSP violations, so nothing needs it.
 * - `style-src 'self' 'unsafe-inline'`: React inline style props plus
 *   MapLibre's injected element styles.
 * - `img-src`/`connect-src`: same-origin app assets + the two raster tile
 *   hosts `components/Map.tsx` uses (Esri World Imagery, OSM) — MapLibre
 *   `fetch`es tiles (connect-src) before drawing them (img-src). BOTH the
 *   bare apex `https://tile.openstreetmap.org` (the literal OSM_TILES host)
 *   and the `https://*.tile.openstreetmap.org` wildcard are listed: a CSP
 *   wildcard matches subdomains only, never the apex itself — Chromium
 *   blocks the bare host on wildcard-only policies (final-review residual).
 * - No font hosts: the map style declares no glyphs/sprites (raster +
 *   circle/fill/line layers only), and Next self-hosts its fonts.
 * - `frame-ancestors 'self'` (plus `X-Frame-Options` for older agents),
 *   `object-src 'none'`, `base-uri 'self'`.
 *
 * `poweredByHeader: false` drops the `x-powered-by: Next.js` fingerprint.
 */
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https://server.arcgisonline.com https://tile.openstreetmap.org https://*.tile.openstreetmap.org",
      "connect-src 'self' https://server.arcgisonline.com https://tile.openstreetmap.org https://*.tile.openstreetmap.org",
      "frame-ancestors 'self'",
      "object-src 'none'",
      "base-uri 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${API_INTERNAL_URL}/:path*`,
      },
    ];
  },
  async headers() {
    // `/:path*` matches every route including `/` (zero segments).
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
