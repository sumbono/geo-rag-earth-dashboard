import type { NextConfig } from "next";

/**
 * Single-origin proxy: the browser only ever talks to this server; `/api/*`
 * is rewritten to the FastAPI backend. Compose sets
 * `API_INTERNAL_URL=http://api:8000`; local dev falls back to localhost:8000.
 */
const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${API_INTERNAL_URL}/:path*`,
      },
    ];
  },
};

export default nextConfig;
