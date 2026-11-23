/**
 * A pill that follows the row under the pointer in a list or menu. It fades in where it is first
 * needed (it never slides in from a stale place), slides between rows on a quick, nearly
 * critically damped spring, and fades out in place. When the same row moves (the list scrolls),
 * the pill moves with it at once, keeping any slide in progress.
 */

import type { Radii, Rect, Rgba, Shape } from "../protocol";
import type { RadiusSpec } from "../core/geometry";
import { concentricRadii, resolveRadii } from "../core/geometry";
import { createSpring, springSet, springTo, stepSpring } from "../core/spring";
import type { Spring } from "../core/spring";
import { highlight as config } from "./constants";
import { shape } from "./shape";

export interface HighlightFrame {
  readonly rect: Rect;
  readonly alpha: number;
  readonly moving: boolean;
}

export interface HighlightMachine {
  /**
   * The row to highlight, in the surface's px, or null for none. `key` names the row: the same
   * key at a new place is the row moving, not a new row.
   */
  target(rect: Rect | null, key?: unknown): void;
  advance(dt: number): HighlightFrame;
}

export function createHighlightMachine(
  options: { reducedMotion?: () => boolean } = {},
): HighlightMachine {
  const x = createSpring();
  const y = createSpring();
  const width = createSpring();
  const height = createSpring();
  const alpha = createSpring(0);
  const box: readonly Spring[] = [x, y, width, height];
  let key: unknown = undefined;
  let shown = false;

  const place = (r: Rect, slide: boolean) => {
    const values = [r.x, r.y, r.width, r.height];
    box.forEach((spring, i) => {
      const value = values[i] ?? 0;
      if (slide) springTo(spring, value, config.slide);
      else springSet(spring, value);
    });
  };

  return {
    target(rect, nextKey) {
      if (!rect) {
        if (shown) springTo(alpha, 0, config.fade);
        shown = false;
        key = undefined;
        return;
      }
      const reduced = options.reducedMotion?.() ?? false;
      // Hidden (or nearly): appear where the row is.
      if (alpha.value < 0.01 && !shown) place(rect, false);
      else if (nextKey !== undefined && nextKey === key) {
        // The same row moved: carry the pill with it, keeping a slide in progress.
        const dx = rect.x - x.target;
        const dy = rect.y - y.target;
        if (dx !== 0 || dy !== 0 || rect.width !== width.target || rect.height !== height.target) {
          x.value += dx;
          y.value += dy;
          x.target = rect.x;
          y.target = rect.y;
          if (!x.active) springSet(x, rect.x);
          if (!y.active) springSet(y, rect.y);
          springTo(width, rect.width, config.slide);
          springTo(height, rect.height, config.slide);
          if (reduced) place(rect, false);
        }
      } else place(rect, !reduced);
      key = nextKey;
      if (!shown) springTo(alpha, 1, config.fade);
      shown = true;
    },
    advance(dt) {
      let moving = false;
      for (const spring of box) moving = stepSpring(spring, dt) || moving;
      moving = stepSpring(alpha, dt) || moving;
      return {
        rect: { x: x.value, y: y.value, width: width.value, height: height.value },
        alpha: Math.max(0, Math.min(1, alpha.value)),
        moving,
      };
    },
  };
}

/**
 * The pill of one highlight frame. With a `container` (the surface's size and corners), its
 * corners are concentric with the container's where it nears them (`concentricRadii`) and
 * `radius` elsewhere. They follow the pill as it slides, so it rounds into a corner as it gets
 * there.
 */
export const highlightShapes = (
  frame: HighlightFrame,
  radius: RadiusSpec,
  tint: Rgba | null = null,
  container: {
    readonly size: { width: number; height: number };
    readonly radii: Radii;
  } | null = null,
): Shape[] => {
  if (frame.alpha <= 0.001) return [];
  const own = resolveRadii(radius, frame.rect);
  const radii = container ? concentricRadii(frame.rect, container.size, container.radii, own) : own;
  return [shape("pill", frame.rect, radii, { alpha: frame.alpha, tint })];
};
