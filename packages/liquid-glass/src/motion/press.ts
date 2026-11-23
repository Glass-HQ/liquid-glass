/**
 * A glass button under a press: it grows, keeping its proportions, a light gathers in it, and a
 * finger dragged outside pulls it after itself through a rubber band. A quick tap still shows the
 * whole growth before it falls back.
 *
 * Growth: every button grows by the same 2.5 px across its width, so a wide button
 * doesn't balloon and a small one still shows it.
 */

import type { Radii, Rect, Shape } from "../protocol";
import { clamp, fitRadii, fromBox, scaleRadii } from "../core/geometry";
import { press as config } from "./constants";
import {
  createLift,
  createPressLight,
  liftMoving,
  liftPress,
  liftRelease,
  lightMoving,
  lightPress,
  lightPressed,
  lightRelease,
  stepLift,
  stepLight,
} from "./lift";
import { shape } from "./shape";
import { createPull, pullMoving, pullRelease, pullToward, stepPull, stretchedBox } from "./stretch";

export interface PressOptions {
  /** Scale at full press. Default: from the button's width, as above. */
  readonly scale?: number;
  readonly reducedMotion?: () => boolean;
}

export interface PressFrame {
  readonly body: Rect;
  readonly scale: number;
  readonly light: number;
  readonly moving: boolean;
}

export interface PressMachine {
  /** The button's own size, in its px. */
  size(width: number, height: number): void;
  press(): void;
  /** Where the finger is now, in the button's px. */
  move(point: { x: number; y: number }): void;
  release(): void;
  advance(dt: number): PressFrame;
  readonly pressed: boolean;
}

/** The full-press scale for a button `width` px wide. */
export function pressScale(width: number): number {
  if (!(width > 0)) return 1;
  const grow = clamp(
    width * (config.scale - 1),
    config.minimumGrow,
    config.measuredSize * (config.scale - 1),
  );
  return 1 + grow / width;
}

export function createPressMachine(options: PressOptions = {}): PressMachine {
  let rest: Rect = { x: 0, y: 0, width: 0, height: 0 };
  const grow = createLift();
  const light = createPressLight();
  const pull = createPull();
  const reduced = () => options.reducedMotion?.() ?? false;

  return {
    get pressed() {
      return lightPressed(light);
    },
    size(width, height) {
      rest = { x: 0, y: 0, width, height };
    },
    press() {
      lightPress(light);
      if (!reduced()) liftPress(grow, config.lift);
    },
    move(point) {
      if (lightPressed(light) && !reduced() && config.pullLimit > 0)
        pullToward(pull, point, rest, config.follow, config.pullLimit);
    },
    release() {
      if (lightPressed(light)) {
        liftRelease(grow, config.lift);
        pullRelease(pull, config.settle);
      }
      lightRelease(light);
    },
    advance(dt) {
      stepLight(light, dt);
      stepLift(grow, dt, config.lift);
      stepPull(pull, dt);
      const scale = 1 + ((options.scale ?? pressScale(rest.width)) - 1) * grow.value.value;
      return {
        body: fromBox(stretchedBox(rest, pull, scale, scale)),
        scale,
        light: light.value,
        moving: lightMoving(light) || liftMoving(grow) || pullMoving(pull),
      };
    },
  };
}

/** The pressed body: the rest corners scaled with the growth, so the shape is kept. */
export const pressShapes = (frame: PressFrame, radii: Radii): Shape[] => [
  shape("body", frame.body, fitRadii(scaleRadii(radii, frame.scale), frame.body), {
    light: frame.light,
  }),
];
