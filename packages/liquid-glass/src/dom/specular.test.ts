import { expect, test } from "bun:test";
import {
  approachAngle,
  lightAngle,
  restingAngle,
  specularMatrix,
  specularResponse,
} from "./specular.js";

/** What the filter's alpha row computes for a field pixel with outward normal n at rim weight e. */
function facing(angle: number, nx: number, ny: number, edge = 1) {
  const r = 0.5 - nx * edge * 0.5,
    g = 0.5 - ny * edge * 0.5;
  const row = specularMatrix(angle).split(" ").map(Number).slice(15);
  return row[0]! * r + row[1]! * g + row[4]!;
}

test("both ends of the axis are lit alike", () => {
  // Light to the right of the glass.
  expect(facing(0, 1, 0)).toBeCloseTo(1, 4);
  expect(facing(0, -1, 0)).toBeCloseTo(0, 4);
  expect(facing(0, 0, 1)).toBeCloseTo(0.5, 4);
  expect(specularResponse(1)).toBeCloseTo(1, 4);
  expect(specularResponse(0)).toBe(0);
  // Both ends of the axis are equally bright.
  for (const v of [0.3, 0.6, 1]) expect(specularResponse(-v)).toBe(specularResponse(v));
});

test("the light points at the pointer, then at the tilt, then from above", () => {
  expect(lightAngle({ pointer: { x: 200, y: 100 } }, 100, 100)).toBeCloseTo(0);
  expect(lightAngle({ pointer: { x: 100, y: 100 } }, 100, 100)).toBe(restingAngle);
  expect(lightAngle({ tilt: { x: 0, y: 0 } }, 0, 0)).toBeCloseTo(restingAngle);
  expect(lightAngle({ tilt: { x: 20, y: 0 } }, 0, 0)).not.toBeCloseTo(restingAngle);
  expect(lightAngle({}, 0, 0)).toBe(restingAngle);
});

test("the axis turns the short way and comes to rest", () => {
  const near = approachAngle(Math.PI - 0.1, -Math.PI + 0.1, 0.016);
  expect(near).toBeGreaterThan(Math.PI - 0.1);
  // A half turn away is the same axis: nothing moves.
  expect(approachAngle(0, Math.PI, 0.016)).toBe(0);
  let angle = 0;
  for (let i = 0; i < 200; i++) angle = approachAngle(angle, 1, 0.016);
  expect(angle).toBeCloseTo(1, 2);
  expect(approachAngle(angle, 1, 0.016)).toBe(angle);
});
