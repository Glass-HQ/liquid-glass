import { expect, test } from "bun:test";
import { roundRectDistance, smoothUnion, windingArea } from "./union";

const pill = (x: number, width = 60) => ({ x, y: 0, width, height: 30, radius: 15 });
const area = (points: [number, number][]) => windingArea(points) / 2;

test("rounded rectangle distance is negative inside and zero on the outline", () => {
  const shape = { x: 0, y: 0, width: 40, height: 20, radius: 10 };
  expect(roundRectDistance(20, 10, shape)).toBeCloseTo(-10);
  expect(roundRectDistance(40, 10, shape)).toBeCloseTo(0);
  expect(roundRectDistance(50, 10, shape)).toBeCloseTo(10);
});

test("a single shape traces one closed loop with its own area and renderer winding", () => {
  const loops = smoothUnion([pill(0)], 16);
  expect(loops).toHaveLength(1);
  const expected = 60 * 30 - (4 - Math.PI) * 15 * 15;
  expect(area(loops[0]!)).toBeGreaterThan(0);
  expect(Math.abs(area(loops[0]!) - expected) / expected).toBeLessThan(0.02);
});

test("distant shapes stay separate; near shapes join with a liquid neck", () => {
  expect(smoothUnion([pill(0), pill(100)], 16)).toHaveLength(2);
  const joined = smoothUnion([pill(0), pill(66)], 16);
  expect(joined).toHaveLength(1);
  // The neck adds material between the shapes beyond their own areas.
  const own = 2 * (60 * 30 - (4 - Math.PI) * 15 * 15);
  expect(area(joined[0]!)).toBeGreaterThan(own);
});

test("outlines respect the renderer's edge budget", () => {
  const loops = smoothUnion([pill(0, 300), pill(310, 300)], 24, 0.5, 200);
  for (const loop of loops) expect(loop.length).toBeLessThanOrEqual(200);
});
