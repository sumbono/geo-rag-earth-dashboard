import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Ruling R-3b: tokens.css declares its :root font aliases through
 * var(--font-display-local) etc., and next/font defines those variables only
 * on the element carrying its variable className. Custom properties substitute
 * per element at computed-value time — so if the classes sit on <body>, the
 * <html>/:root aliases resolve invalid and every font-family silently falls
 * back to the UA default. Source-level guard: the three variable expressions
 * must be on <html> and must NOT be on <body>.
 */

// vitest runs from the web package root (npm test in apps/web)
const src = readFileSync(path.resolve(process.cwd(), "app/layout.tsx"), "utf8");

const FONT_VARS = [
  "${display.variable}",
  "${body.variable}",
  "${mono.variable}",
] as const;

function openTag(name: "html" | "body"): string {
  const match = src.match(new RegExp(`<${name}\\b[^>]*>`));
  return match?.[0] ?? "";
}

describe("root layout font variables (R-3b)", () => {
  it("finds both the <html> and <body> opening tags in layout.tsx", () => {
    expect(openTag("html")).not.toBe("");
    expect(openTag("body")).not.toBe("");
  });

  it("carries all three next/font variable classes on <html>", () => {
    const html = openTag("html");
    for (const variable of FONT_VARS) {
      expect(html).toContain(variable);
    }
  });

  it("keeps the font variable classes off <body>", () => {
    const body = openTag("body");
    for (const variable of FONT_VARS) {
      expect(body).not.toContain(variable);
    }
  });
});
