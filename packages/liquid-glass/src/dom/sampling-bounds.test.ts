import { expect, test } from "bun:test";
import { refractionSamplingBounds, unionSamplingBounds } from "./sampling-bounds.js";

const box = { x: 318, y: 178, width: 264, height: 244 };
const contains = (bounds: typeof box, x: number, y: number) => x >= bounds.x && y >= bounds.y && x <= bounds.x + bounds.width && y <= bounds.y + bounds.height;

test("large inward lenses need only interpolation and quantization outsets", () => {
  const bounds = refractionSamplingBounds(box, 60, true);
  const padding = 3 + 60 / 255;
  expect(bounds.x).toBeCloseTo(box.x - padding);
  expect(bounds.y).toBeCloseTo(box.y - padding);
  expect(bounds.width).toBeCloseTo(box.width + 2 * padding);
  expect(bounds.height).toBeCloseTo(box.height + 2 * padding);
  expect(bounds.width * bounds.height).toBeLessThan((box.width + 126) * (box.height + 126) / 2);
});

test("thin lenses retain samples that overshoot the opposite edge", () => {
  const thin = { x: -2, y: -2, width: 104, height: 44 };
  const bounds = refractionSamplingBounds(thin, 60, true);
  expect(bounds.x).toBeCloseTo(-2 - (60 - 52) - 60 / 255 - 3);
  expect(bounds.y).toBeCloseTo(-2 - (60 - 22) - 60 / 255 - 3);
  expect(contains(bounds, 50, 60)).toBe(true);
  expect(contains(bounds, 50, -20)).toBe(true);
});

test("arbitrary outlines and reversed displacement keep full reach", () => {
  const expected = { x: 255, y: 115, width: 390, height: 370 };
  expect(refractionSamplingBounds(box, 60)).toEqual(expected);
  expect(refractionSamplingBounds(box, -60, true)).toEqual(expected);
  expect(refractionSamplingBounds(box, 0, true)).toEqual({ x: 315, y: 175, width: 270, height: 250 });
  // Extreme strength must never exceed the original full-reach bound.
  const strong = refractionSamplingBounds({ x: 0, y: 0, width: 4, height: 4 }, 10_000, true);
  expect(strong.width).toBeLessThanOrEqual(20_010);
});

test("combined sampling regions contain the extrema of their constituent regions", () => {
  const a = refractionSamplingBounds({ x: 20, y: 30, width: 44, height: 32 }, 60, true);
  const b = refractionSamplingBounds({ x: 160, y: 90, width: 264, height: 244 }, 60, true);
  const union = unionSamplingBounds([a, b]);
  for (const mix of [0, .1, .5, .9, 1]) {
    for (const ax of [a.x, a.x + a.width]) for (const ay of [a.y, a.y + a.height])
      for (const bx of [b.x, b.x + b.width]) for (const by of [b.y, b.y + b.height])
        expect(contains(union, ax * (1 - mix) + bx * mix, ay * (1 - mix) + by * mix)).toBe(true);
  }
  expect(() => unionSamplingBounds([])).toThrow(RangeError);
});

test("low-alpha arithmetic blends need full reach when map rectangles differ", () => {
  const mapBox = { x: 0, y: 0, width: 264, height: 244 };
  // A neutral map visible at 0.5% opacity rounds its premultiplied channel
  // and alpha to the same byte. Unpremultiplying then produces full travel.
  const mix = .005;
  const channel = Math.round(128 * mix) / Math.round(255 * mix);
  const sampleX = 240 + 120 * (channel - .5);
  expect(contains(refractionSamplingBounds(mapBox, 60, true), sampleX, 100)).toBe(false);
  expect(contains(refractionSamplingBounds(mapBox, 60), sampleX, 100)).toBe(true);
});
