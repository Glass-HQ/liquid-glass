import { expect, test } from "bun:test";
import { cornerOptions, shapePath, shapeSegments } from "./shape.js";
import type { GlassRadius } from "./shape.js";

test("all Lisse shapes produce a bounded, connected top-right GPU outline", () => {
  for (const [width, height] of [[280,60], [60,280], [28,28], [4090,1000], [0.5,1]]) {
    for (const radius of [0,8,28,1000,"capsule","circle"] as GlassRadius[]) {
      const { segments, count } = shapeSegments(width!, height!, radius);
      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThanOrEqual(128);
      for (let i = 0; i < count; i++) {
        const edge = segments[i]!;
        expect(edge.every(Number.isFinite)).toBe(true);
        expect(edge[0]!).toBeGreaterThanOrEqual(width!/2 - 0.001);
        expect(edge[1]!).toBeLessThanOrEqual(height!/2 + 0.001);
        if (i) {
          const previous = segments[i-1]!;
          expect(Math.hypot(edge[0]!-previous[2]!,edge[1]!-previous[3]!)).toBeLessThan(0.002);
        }
      }
    }
  }
});
test("capsules use Lisse smoothing and circles use circular arcs", () => {
  expect(shapePath(160,32,"capsule")).not.toBe(shapePath(160,32,"circle"));
  expect(cornerOptions("circle").curve).toBe("arc");
  expect(cornerOptions("capsule").curve).toBe("squircle");
});
test("invalid radii fail explicitly", () => {
  for (const radius of [NaN, Infinity, -1, "legacy"]) {
    expect(() => cornerOptions(radius as GlassRadius)).toThrow(RangeError);
  }
});
