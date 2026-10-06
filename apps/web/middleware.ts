import { NextResponse, type NextRequest } from "next/server";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://localhost:8000";

/**
 * Runtime `/api` proxy to the FastAPI backend.
 *
 * `next.config.ts` declares the equivalent rewrite, but Next evaluates
 * `rewrites()` only at BUILD time (the destination is baked into
 * `.next/routes-manifest.json`), while compose supplies `API_INTERNAL_URL`
 * at RUNTIME. Middleware runs per request with the live environment, so the
 * container targets `http://api:8000` and local dev targets
 * `http://localhost:8000`. The `/api` prefix is stripped to match the
 * backend's route layout (`/api/health` → `/health`).
 */
export function middleware(request: NextRequest): Response {
  const backendPath = request.nextUrl.pathname.replace(/^\/api/, "") || "/";
  const target = new URL(
    `${backendPath}${request.nextUrl.search}`,
    API_INTERNAL_URL,
  );
  return NextResponse.rewrite(target);
}

export const config = {
  matcher: "/api/:path*",
};
