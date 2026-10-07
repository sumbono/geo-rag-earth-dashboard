import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { middleware } from "../middleware";

describe("api proxy middleware", () => {
  it("strips the /api prefix and targets the backend root", () => {
    const request = new NextRequest("http://localhost:3000/api/health");
    const response = middleware(request);

    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "http://localhost:8000/health",
    );
  });

  it("forwards query strings", () => {
    const request = new NextRequest(
      "http://localhost:3000/api/telemetry/query?buoy_id=buoy-rs-1&hours=24",
    );
    const response = middleware(request);

    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "http://localhost:8000/telemetry/query?buoy_id=buoy-rs-1&hours=24",
    );
  });
});
