import { expect, test } from "bun:test";
import { Spring, rubberBand, settleTime, springs } from "./spring";

test("a critically damped spring reaches its target without overshoot", () => {
  const spring = new Spring(0, { duration: 0.4, bounce: 0 });
  spring.target = 1;
  let peak = 0;
  for (let i = 0; i < 240 && !spring.settled; i++) peak = Math.max(peak, spring.step(1 / 120).value);
  expect(spring.settled).toBe(true);
  expect(spring.value).toBe(1);
  expect(peak).toBeLessThanOrEqual(1);
});

test("bounce overshoots, and the result does not depend on frame rate", () => {
  const fine = new Spring(0, springs.release), coarse = new Spring(0, springs.release);
  fine.target = coarse.target = 100;
  for (let i = 0; i < 24; i++) fine.step(1 / 240);
  for (let i = 0; i < 6; i++) coarse.step(1 / 60);
  expect(coarse.value).toBeCloseTo(fine.value, 6);
  expect(coarse.velocity).toBeCloseTo(fine.velocity, 4);
  let peak = 0;
  while (!fine.settled) peak = Math.max(peak, fine.step(1 / 60).value);
  expect(peak).toBeGreaterThan(100);
});

test("retargeting preserves velocity, so reversal is continuous", () => {
  const spring = new Spring(0, springs.morph);
  spring.target = 1;
  spring.step(0.08);
  const { value, velocity } = spring;
  expect(velocity).toBeGreaterThan(0);
  spring.target = 0;
  spring.step(1 / 1000);
  expect(spring.value).toBeCloseTo(value + velocity / 1000, 3);
});

test("overdamped springs settle monotonically", () => {
  const spring = new Spring(10, { duration: 0.3, bounce: -0.5 });
  spring.target = 0;
  let previous = 10;
  while (!spring.settled) {
    spring.step(1 / 60);
    expect(spring.value).toBeLessThanOrEqual(previous);
    expect(spring.value).toBeGreaterThanOrEqual(0);
    previous = spring.value;
  }
});

test("settle time is finite and grows with bounce", () => {
  const calm = settleTime({ duration: 0.4, bounce: 0 }, 0, 1);
  const lively = settleTime({ duration: 0.4, bounce: 0.5 }, 0, 1);
  expect(calm).toBeGreaterThan(0.2);
  expect(lively).toBeGreaterThan(calm);
  expect(lively).toBeLessThan(5);
});

test("rubber band follows small offsets and never reaches its limit", () => {
  expect(rubberBand(0, 10)).toBe(0);
  expect(rubberBand(1, 10)).toBeCloseTo(0.52, 2);
  expect(rubberBand(-1000, 10)).toBeGreaterThan(-10);
  expect(rubberBand(-1000, 10)).toBeLessThan(-9.5);
});

test("invalid springs are rejected", () => {
  expect(() => new Spring(0, { duration: 0, bounce: 0 })).toThrow(RangeError);
  expect(() => new Spring(0, { duration: 1, bounce: 1 })).toThrow(RangeError);
});
