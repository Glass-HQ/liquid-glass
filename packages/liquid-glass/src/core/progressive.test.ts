import { expect, test } from "bun:test";
import {
  physicalEdge,
  scrollEdgeStrength,
  validateProgressive,
} from "./progressive";

test("logical edges follow direction", () => {
  expect(physicalEdge("inline-start", false)).toBe("left");
  expect(physicalEdge("inline-start", true)).toBe("right");
  expect(physicalEdge("inline-end", true)).toBe("left");
});
test("no overflow and reached boundaries are clear, including rubber-banding", () => {
  for (const edge of ["top", "bottom", "left", "right"] as const)
    expect(scrollEdgeStrength(edge, 0, 0, 0, 0, false, 80)).toBe(0);
  expect(scrollEdgeStrength("top", 0, -20, 0, 100, false, 80)).toBe(0);
  expect(scrollEdgeStrength("bottom", 0, 120, 0, 100, false, 80)).toBe(0);
  expect(scrollEdgeStrength("bottom", 0, 0, 0, 100, false, 80)).toBe(1);
  expect(scrollEdgeStrength("top", 0, 16, 0, 100, false, 80)).toBe(0.5);
});
test("horizontal RTL clears the correct physical edge", () => {
  expect(scrollEdgeStrength("right", 0, 0, 300, 0, true, 80)).toBe(0);
  expect(scrollEdgeStrength("left", 0, 0, 300, 0, true, 80)).toBe(1);
  expect(scrollEdgeStrength("left", -300, 0, 300, 0, true, 80)).toBe(0);
  expect(scrollEdgeStrength("right", -300, 0, 300, 0, true, 80)).toBe(1);
});
test("rejects invalid or unbounded effects before registering them", () => {
  for (const value of [NaN, Infinity, -1]) {
    expect(() => validateProgressive({ size: value })).toThrow(RangeError);
    expect(() => validateProgressive({ blur: value })).toThrow(RangeError);
    expect(() => validateProgressive({ refraction: value })).toThrow(
      RangeError,
    );
  }
  expect(() => validateProgressive({ blur: 65 })).toThrow(RangeError);
  expect(() =>
    validateProgressive({ size: 0, blur: 0, refraction: 0 }),
  ).not.toThrow();
});
