import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

/**
 * Spec §6 hardening checklist — the header config itself (web vitest cannot
 * see headers on a served response, so this proves the export; the e2e
 * asserts the same headers as actually delivered over HTTP).
 */

describe("next.config security headers (spec §6)", () => {
  it("stops emitting the x-powered-by fingerprint", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it("applies X-Frame-Options / nosniff / Referrer-Policy / CSP to every route", async () => {
    const routes = await nextConfig.headers!();
    const root = routes.find((route) => route.source === "/:path*");
    expect(root).toBeDefined();

    const byKey = new Map(root!.headers.map((h) => [h.key.toLowerCase(), h.value]));
    expect(byKey.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(byKey.get("x-content-type-options")).toBe("nosniff");
    expect(byKey.get("referrer-policy")).toBe("strict-origin-when-cross-origin");

    const csp = byKey.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("img-src 'self' data:");
    expect(csp).toContain("https://server.arcgisonline.com");
    expect(csp).toContain("https://*.tile.openstreetmap.org");
    // Evidence-based exclusions: no eval anywhere in the prod bundle, and
    // frames/scripts/fonts/object sources stay locked to 'self'.
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
  });
});
