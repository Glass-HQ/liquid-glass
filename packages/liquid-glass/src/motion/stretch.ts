/**
 * Glass that a finger pulls past its edge. The pull is a rubber band towards the finger, carried
 * by springs so it eases in and snaps back; the glass grows towards the finger by the pull and
 * squeezes across it, as a drop of liquid would.
 */

import type { Rect } from "../protocol";
import type { Box } from "../core/geometry";
import { rubberBandPull } from "../core/rubber-band";
import { createSpring, springTo, stepSpring } from "../core/spring";
import type { Spring, SpringParams } from "../core/spring";
import { stretch } from "./constants";

export interface Pull {
  readonly x: Spring;
  readonly y: Spring;
}

export const createPull = (): Pull => ({ x: createSpring(0), y: createSpring(0) });

/** Pull towards a point (rubber-banded outside `rect`, zero inside). */
export function pullToward(
  pull: Pull,
  point: { readonly x: number; readonly y: number },
  rect: Rect,
  params: SpringParams,
  limit: number = stretch.limit,
): void {
  const target = rubberBandPull(point, rect, limit, stretch.resistance);
  if (target.x !== pull.x.target || pull.x.active) springTo(pull.x, target.x, params);
  if (target.y !== pull.y.target || pull.y.active) springTo(pull.y, target.y, params);
}

export function pullRelease(pull: Pull, params: SpringParams): void {
  springTo(pull.x, 0, params);
  springTo(pull.y, 0, params);
}

export function stepPull(pull: Pull, dt: number): void {
  stepSpring(pull.x, dt);
  stepSpring(pull.y, dt);
}

export const pullMoving = (pull: Pull): boolean => pull.x.active || pull.y.active;

/**
 * `rect` scaled by (sx, sy) about its centre, grown towards the pull by the pull's length and
 * squeezed across it: a pull of p along x makes it 1 / (1 + 0.08 · |p| / width) as tall.
 */
export function stretchedBox(rect: Rect, pull: Pull, sx: number, sy: number): Box {
  const px = pull.x.value;
  const py = pull.y.value;
  const squeezeX = 1 / (1 + (Math.abs(py) / Math.max(rect.height, 1e-6)) * stretch.squeeze);
  const squeezeY = 1 / (1 + (Math.abs(px) / Math.max(rect.width, 1e-6)) * stretch.squeeze);
  return {
    x: rect.x + rect.width / 2 + px / 2,
    y: rect.y + rect.height / 2 + py / 2,
    width: (rect.width * sx + Math.abs(px)) * squeezeX,
    height: (rect.height * sy + Math.abs(py)) * squeezeY,
  };
}

/**
 * Carry a box inside a bar along with the bar's stretch. While the bar only grows from a press,
 * the box just follows the bar's centre; once the bar is pulled past that growth (eased in over
 * `stretch.ease` px), the box stretches with it about the bar's centre.
 */
export function followBar(
  box: Box,
  shown: Box,
  bar: Rect,
  pressWidth: number,
  pressHeight: number,
): Box {
  const pressedWidth = bar.width * pressWidth;
  const pressedHeight = bar.height * pressHeight;
  const amount = Math.min(
    1,
    Math.max(shown.width - pressedWidth, shown.height - pressedHeight) / stretch.ease,
  );
  const cx = bar.x + bar.width / 2;
  const cy = bar.y + bar.height / 2;
  if (!(amount > 0)) return { ...box, x: box.x + (shown.x - cx), y: box.y + (shown.y - cy) };
  const sx = 1 + amount * (shown.width / pressedWidth - 1);
  const sy = 1 + amount * (shown.height / pressedHeight - 1);
  return {
    x: cx + (shown.x - cx) + (box.x - cx) * sx,
    y: cy + (shown.y - cy) + (box.y - cy) * sy,
    width: box.width * sx,
    height: box.height * sy,
  };
}
