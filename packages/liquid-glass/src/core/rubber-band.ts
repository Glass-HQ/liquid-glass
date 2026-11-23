/**
 * A rubber band past a scroll's edges: a short pull follows almost one to
 * one, a long one approaches `limit` and never reaches it. `resistance` sets how quickly it
 * stiffens (0.55 is the scroll view's coefficient; glass bars use a stiffer 0.12).
 *
 *   rubberBand(d) = (1 − 1 / (d · resistance / limit + 1)) · limit
 */

import type { Rect } from "../protocol";

export function rubberBand(distance: number, limit: number, resistance = 0.55): number {
  if (!(limit > 0) || distance === 0) return 0;
  const magnitude = Math.abs(distance);
  return Math.sign(distance) * (1 - 1 / ((magnitude * resistance) / limit + 1)) * limit;
}

/** The distance that `rubberBand` turns into `offset`. Infinite at or beyond the limit. */
export function rubberBandInverse(offset: number, limit: number, resistance = 0.55): number {
  if (!(limit > 0) || offset === 0) return 0;
  const magnitude = Math.abs(offset);
  if (magnitude >= limit) return Math.sign(offset) * Infinity;
  return (Math.sign(offset) * magnitude) / (resistance * (1 - magnitude / limit));
}

/**
 * How far a point outside a rect pulls it, per axis, through the rubber band: zero inside, and
 * a resisted offset towards the point outside.
 */
export function rubberBandPull(
  point: { readonly x: number; readonly y: number },
  rect: Rect,
  limit: number,
  resistance: number,
): { x: number; y: number } {
  const dx =
    point.x < rect.x
      ? point.x - rect.x
      : point.x > rect.x + rect.width
        ? point.x - rect.x - rect.width
        : 0;
  const dy =
    point.y < rect.y
      ? point.y - rect.y
      : point.y > rect.y + rect.height
        ? point.y - rect.y - rect.height
        : 0;
  return { x: rubberBand(dx, limit, resistance), y: rubberBand(dy, limit, resistance) };
}
