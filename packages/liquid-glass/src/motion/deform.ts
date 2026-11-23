/**
 * A moving lens squashes along its path with speed and wobbles back when it stops.
 *
 * The speed ("pace", 1 at `fastAt` px/s) is smoothed from position samples. Samples can arrive
 * at any rate (60 Hz pointer events, 120 Hz controllers, nothing for a few frames), so the
 * machine learns the sample interval and only treats the finger as stopped after a few missed
 * intervals. The shape is a spring towards `fastest · pace`, plus a kick the other way whenever
 * the pace drops, which is the wobble.
 */

import { clamp } from "../core/geometry";
import { deform as defaults } from "./constants";
import type { DeformParams } from "./constants";

export type { DeformParams };

interface Shape {
  readonly at: number;
  readonly pace: number;
  readonly rate: number;
  readonly shape: number;
}

const still: Shape = { at: 0, pace: 0, rate: 0, shape: 0 };

export interface Deform {
  shape: Shape;
  readonly input: { since: number; interval: number };
  /** Which position drives it; switching sources must not read as a jump. */
  source: string;
  /** The current squash: the lens is (1 + s) as long and 1 / (1 + s) as thick. */
  stretch: number;
  readonly params: DeformParams;
}

export const createDeform = (source = "", params: DeformParams = defaults): Deform => ({
  shape: still,
  input: { since: 0, interval: params.startInterval },
  source,
  stretch: 0,
  params,
});

function pace(
  deform: DeformParams,
  shape: Shape,
  at: number,
  dt: number,
  input: Deform["input"],
): number {
  const step = (seconds: number) => clamp(seconds, deform.stepShortest, deform.stepLongest);
  if (at !== shape.at) {
    const interval = step(input.since);
    const speed = Math.abs(at - shape.at) / interval / deform.fastAt;
    input.interval +=
      (Math.min(deform.stepLongest, input.since) - input.interval) * deform.intervalBlend;
    input.since = 0;
    return shape.pace + (speed - shape.pace) * (1 - Math.exp(-interval / deform.paceSmoothing));
  }
  if (input.since > input.interval * deform.holdFrames) {
    return shape.pace - shape.pace * (1 - Math.exp(-step(dt) / deform.paceSmoothing));
  }
  return shape.pace;
}

function advance(
  deform: DeformParams,
  shape: Shape,
  at: number,
  dt: number,
  input: Deform["input"],
): Shape {
  input.since += dt;
  const nextPace = pace(deform, shape, at, dt, input);
  const h = clamp(dt, deform.stepShortest, deform.stepLongest);
  const omega = (2 * Math.PI) / deform.spring.response;
  const target = Math.min(1, nextPace) * deform.fastest;
  const accel =
    omega * omega * (target - shape.shape) - 2 * deform.spring.dampingRatio * omega * shape.rate;
  const rate = shape.rate + accel * h + deform.jolt * Math.min(0, nextPace - shape.pace);
  return {
    at,
    pace: nextPace,
    rate,
    shape: clamp(shape.shape + rate * h, deform.narrowest, deform.widest),
  };
}

/**
 * Feed the lens position for this frame. `engaged` is false once the lens is no longer lifted;
 * the squash then settles to rest and stops.
 */
export function stepDeform(
  state: Deform,
  source: string,
  position: number,
  engaged: boolean,
  dt: number,
): void {
  const current = state.shape;
  if (source !== state.source) {
    state.source = source;
    state.shape = { at: position, pace: current.pace, rate: current.rate, shape: current.shape };
    return;
  }
  if (!engaged && current.shape === 0 && current.rate === 0) {
    state.shape = { at: position, pace: 0, rate: 0, shape: 0 };
    return;
  }
  const deform = state.params;
  const next = advance(deform, current, position, dt, state.input);
  const resting =
    !engaged && Math.abs(next.shape) < deform.restShape && Math.abs(next.rate) < deform.restRate;
  state.shape = resting ? { at: position, pace: 0, rate: 0, shape: 0 } : next;
  state.stretch = resting ? 0 : next.shape;
}

export const deformMoving = (state: Deform): boolean =>
  Math.abs(state.shape.shape) > state.params.restShape ||
  Math.abs(state.shape.rate) > state.params.restRate ||
  state.shape.pace > state.params.restPace;

/**
 * The scale a squash gives along (x) and across (y) the path. `across` is how many times the
 * squash the thickness loses; without it, the lens keeps its area.
 */
export const squash = (amount: number, across?: number): { x: number; y: number } => ({
  x: 1 + amount,
  y: across === undefined ? 1 / (1 + amount) : 1 - across * amount,
});
