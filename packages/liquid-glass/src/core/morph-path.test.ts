import { expect, test } from "bun:test";
import { morphDraw, morphShape, openingAxis, planMorph, radiusPixels } from "./morph-path.js";
import type { MorphEndpoints } from "./morph-path.js";

const button = { left: 100, top: 100, width: 28, height: 28 };
const menu = { left: 0, top: 136, width: 148, height: 92 };
const path: MorphEndpoints = { from: button, fromRadius: "circle", to: menu, toRadius: 28, along: "y" };

test("the opening axis is the one the popup lies beyond", () => {
  expect(openingAxis(button, menu)).toBe("y");
  expect(openingAxis(button, { left: 136, top: 60, width: 148, height: 92 })).toBe("x");
});

test("the path is exact at both ends", () => {
  const start = morphShape(path, 0), end = morphShape(path, 1);
  expect(start).toEqual({ ...button, radius: 14 });
  expect(end).toEqual({ ...menu, radius: 28 });
});

test("the opening axis leads, corners stay drop-like in flight, and overshoot swells evenly", () => {
  const mid = morphShape(path, 0.5);
  const alongProgress = (mid.height - button.height) / (menu.height - button.height);
  const acrossProgress = (mid.width - button.width) / (menu.width - button.width);
  expect(alongProgress).toBeGreaterThan(acrossProgress);
  // Drop corners: well beyond the settled radius, short of a full capsule.
  expect(mid.radius).toBeGreaterThan(0.3 * Math.min(mid.width, mid.height));
  expect(mid.radius).toBeLessThan(Math.min(mid.width, mid.height) / 2);
  // A round source stays round as it leaves.
  const early = morphShape(path, 0.03);
  expect(early.radius).toBeGreaterThan(0.48 * Math.min(early.width, early.height));
  for (let p = 0; p <= 1.2; p += 0.05) {
    const s = morphShape(path, p);
    expect(s.radius).toBeLessThanOrEqual(Math.min(s.width, s.height) / 2 + 1e-9);
  }
  const over = morphShape(path, 1.1);
  expect(over.width).toBeGreaterThan(menu.width);
  expect(over.height).toBeGreaterThan(menu.height);
  expect(over.radius).toBe(28);
});

test("a layout path without an opening axis moves both axes together", () => {
  const s = morphShape({ from: button, fromRadius: "capsule", to: { left: 0, top: 0, width: 128, height: 28 }, toRadius: "capsule" }, 0.5);
  expect(s.width).toBe(78);
  expect(s.radius).toBe(14);
});

test("a plan runs from the exact source to the exact target through evenly spaced shapes", () => {
  const stops = planMorph(path, undefined, { stops: 10, dpr: 1, restDpr: 2 });
  expect(stops[0]!.shape).toEqual({ width: 28, height: 28, radius: "circle", dpr: 2, resting: true });
  expect(stops.at(-1)!.shape).toEqual({ width: 148, height: 92, radius: 28, dpr: 2, resting: true });
  expect(stops.slice(1, -1).every((stop) => !stop.shape.resting)).toBe(true);
  expect(stops.length).toBe(10);
  for (let i = 1; i < stops.length; i++) expect(stops[i]!.p).toBeGreaterThan(stops[i - 1]!.p);
  expect(stops.every((stop) => !stop.absorbs && !stop.box)).toBe(true);
  // Shapes in the first half of the path keep drop-like corners.
  for (const stop of stops.slice(1, 5)) expect(Number(stop.shape.radius)).toBeGreaterThan(0.3 * Math.min(stop.shape.width, stop.shape.height));
});

test("a drop leaving a toolbar starts as the toolbar, is joined by traced unions, then parts", () => {
  const toolbar = { left: 40, top: 96, width: 120, height: 36, layoutWidth: 120, layoutHeight: 36, radius: "capsule" as const };
  const trigger = { left: 128, top: 100, width: 28, height: 28 };
  const drop: MorphEndpoints = { from: trigger, fromRadius: "circle", to: { left: 8, top: 140, width: 148, height: 92 }, toRadius: 28, along: "y" };
  const stops = planMorph(drop, toolbar, { stops: 12, unions: 8 });
  expect(stops[0]!.absorbs).toBe(true);
  expect(stops[0]!.shape).toEqual({ width: 120, height: 36, radius: "capsule", dpr: 1, resting: true });
  const unions = stops.filter((stop) => stop.shape.outline);
  expect(unions.length).toBeGreaterThan(2);
  expect(unions.every((stop) => stop.absorbs && stop.box)).toBe(true);
  const parted = stops.findIndex((stop, i) => i > 0 && !stop.absorbs);
  expect(parted).toBeGreaterThan(1);
  expect(stops.slice(parted).every((stop) => !stop.absorbs)).toBe(true);
  expect(stops.at(-1)!.p).toBe(1);
  for (let i = 1; i < stops.length; i++) expect(stops[i]!.p).toBeGreaterThan(stops[i - 1]!.p);
  // Nothing is drawn while the drop is still inside its glass.
  expect(morphDraw(stops, 0)).toBeUndefined();
  const joined = morphDraw(stops, (unions[1]!.p + unions[2]!.p) / 2)!;
  expect(joined.absorb).toBe(1);
  expect(joined.a.shape.outline).toBeDefined();
  const parting = morphDraw(stops, (stops[parted - 1]!.p + stops[parted]!.p) / 2)!;
  expect(parting.absorb).toBeCloseTo(0.5, 5);
  expect(morphDraw(stops, 1)!.absorb).toBe(0);
});

test("a frame blends the two stops around its progress", () => {
  const stops = planMorph(path, undefined, { stops: 6 });
  const between = morphDraw(stops, (stops[2]!.p + stops[3]!.p) / 2)!;
  expect(between.a).toBe(stops[2]!);
  expect(between.b).toBe(stops[3]!);
  expect(between.mix).toBeCloseTo(0.5, 5);
  expect(morphDraw(stops, 1.2)).toEqual({ a: stops.at(-1)!, mix: 0, absorb: 0 });
  expect(morphDraw(stops, -0.5)).toBeUndefined();
});

test("declared radii resolve to pixels within the shape", () => {
  expect(radiusPixels("capsule", 100, 28)).toBe(14);
  expect(radiusPixels(28, 40, 40)).toBe(20);
  expect(radiusPixels("8", 100, 100)).toBe(8);
});
