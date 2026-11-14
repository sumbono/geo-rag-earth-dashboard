import { describe, expect, it } from "vitest";
import { buildUrlState, parseUrlState } from "../lib/urlState";

describe("urlState (P1 shareability)", () => {
  it("round-trips q, bbox and tile", () => {
    const built = buildUrlState({ q: "turquoise water", bbox: [[38, 21], [39, 22]], tile: "abc-123" });
    const parsed = parseUrlState(built);
    expect(parsed.q).toBe("turquoise water");
    expect(parsed.bbox).toEqual([[38, 21], [39, 22]]);
    expect(parsed.tile).toBe("abc-123");
  });

  it("drops absent parts and tolerates garbage", () => {
    expect(buildUrlState({ q: "", bbox: null, tile: null })).toBe("");
    expect(parseUrlState("?bbox=not,numbers")).toEqual({});
    expect(parseUrlState("?bbox=1,2,3")).toEqual({});
    expect(() => parseUrlState("?q=%E0%A4%A")).not.toThrow();
  });
});
