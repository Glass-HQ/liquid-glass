import { expect, test } from "bun:test";
import { edgeDisplacement } from "./optics";
test("refraction points inward at the lip and disappears at material depth", () => {
  expect(edgeDisplacement(0, -60, 0.05)).toBe(-60);
  expect(edgeDisplacement(-20, -60, 0.05)).toBeCloseTo(0);
  let previous = 60;
  for (let depth = 0; depth <= 20; depth += 0.1) {
    const offset = Math.abs(edgeDisplacement(-depth, -60, 0.05));
    expect(offset).toBeLessThanOrEqual(previous);
    previous = offset;
  }
});
