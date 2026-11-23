/**
 * A control thumb (switch, slider) that lifts into a glass lens while held:
 *
 * - the lift takes 210 ms on an ease-in-out curve, both ways;
 * - a short press (under 80 ms, released before half lifted) instead plays a tap
 *   envelope: the lens peaks at about 0.35 and is gone by 287 ms;
 * - the lens grows past the thumb by 0.45 of the thumb's height at each end and 0.275 above and
 *   below (a 32×20 thumb lifts into a 50×31 lens);
 * - while moving it stretches along its path with speed, up to 2.5%, and wobbles back.
 */

import type { Rect, Shape } from "../protocol";
import { resolveRadii, scaleRect } from "../core/geometry";
import { createSpring, cubicBezier, springTo, stepSpring } from "../core/spring";
import { lens as lensConfig, thumb as config } from "./constants";
import { shape } from "./shape";

export interface ThumbFrame {
  /** 0..1: how far the thumb has lifted into its lens. */
  readonly progress: number;
  /** Squash along the path: the lens is (1 + s) long and (1 − 1.25 s) thick. */
  readonly stretch: number;
  readonly moving: boolean;
}

export interface ThumbMachine {
  press(now: number): void;
  release(now: number): void;
  /** `position` is where the thumb is along its path (px), for its speed. */
  advance(dt: number, now: number, position: number): ThumbFrame;
  readonly pressed: boolean;
}

function tapLift(seconds: number): number {
  const envelope = config.tapEnvelope;
  for (let i = 1; i < envelope.length; i += 1) {
    const [time, lift] = envelope[i]!;
    if (seconds <= time) {
      const [before, value] = envelope[i - 1]!;
      return value + (lift - value) * Math.max(0, (seconds - before) / (time - before));
    }
  }
  return 0;
}

export function createThumbMachine(options: { reducedMotion?: () => boolean } = {}): ThumbMachine {
  let pressed = false;
  let pressedAt = 0;
  let pulse = false;
  let progress = 0;
  let transition = { at: -Infinity, from: 0, to: 0 };
  let lastPosition: number | null = null;
  let speed = 0;
  const stretch = createSpring(0);
  const reduced = () => options.reducedMotion?.() ?? false;

  return {
    get pressed() {
      return pressed;
    },
    press(now) {
      if (pressed) return;
      pressed = true;
      pressedAt = now;
      pulse = false;
      transition = { at: now, from: progress, to: 1 };
    },
    release(now) {
      if (!pressed) return;
      pressed = false;
      pulse = now - pressedAt < config.tapMs && progress < 0.5;
      transition = { at: now, from: progress, to: 0 };
    },
    advance(dt, now, position) {
      let lifting: boolean;
      if (reduced()) {
        progress = pressed ? 1 : 0;
        lifting = false;
      } else if (pulse) {
        const seconds = (now - pressedAt) / 1000;
        progress = tapLift(seconds);
        lifting = seconds < (config.tapEnvelope.at(-1)?.[0] ?? 0);
        if (!lifting) pulse = false;
      } else {
        const t = Math.min(1, (now - transition.at) / config.liftMs);
        progress =
          transition.from +
          (transition.to - transition.from) * cubicBezier(config.liftCurve, t, 16);
        lifting = t < 1;
      }

      // Speed is smoothed over about 50 ms so uneven input doesn't make the lens flicker.
      if (lastPosition !== null && dt > 0)
        speed += ((position - lastPosition) / dt - speed) * Math.min(1, dt * 18);
      lastPosition = position;
      if (reduced()) speed = 0;
      springTo(
        stretch,
        Math.min(config.stretchMax, Math.abs(speed) * config.stretchPerSpeed) * progress,
        config.stretchSpring,
      );
      stepSpring(stretch, dt);
      // Once settled, the speed estimate decays to zero instead of keeping the loop awake.
      if (Math.abs(speed) <= 1) speed = 0;

      return {
        progress,
        stretch: stretch.value,
        moving: lifting || stretch.active || speed !== 0,
      };
    },
  };
}

/** Which control a thumb belongs to: their lenses grow differently. */
export type ThumbKind = "switch" | "slider";

/** The lens around a thumb of `size`, in the thumb's px. */
export function thumbLensRect(
  size: { width: number; height: number },
  frame: ThumbFrame,
  vertical = false,
  kind: ThumbKind = "switch",
): Rect {
  const length = vertical ? size.height : size.width;
  const thickness = vertical ? size.width : size.height;
  const growAlong =
    (kind === "slider" ? config.sliderGrow * length : config.growX * thickness) * frame.progress;
  const growAcross =
    (kind === "slider" ? config.sliderGrow * thickness : config.growY * thickness) * frame.progress;
  const grown: Rect = vertical
    ? {
        x: -growAcross,
        y: -growAlong,
        width: size.width + growAcross * 2,
        height: size.height + growAlong * 2,
      }
    : {
        x: -growAlong,
        y: -growAcross,
        width: size.width + growAlong * 2,
        height: size.height + growAcross * 2,
      };
  const along = 1 + frame.stretch;
  const across = 1 - config.stretchAcross * frame.stretch;
  return vertical ? scaleRect(grown, across, along) : scaleRect(grown, along, across);
}

/** The thumb's lens as a shape, or nothing while the thumb rests. */
export function thumbShapes(
  size: { width: number; height: number },
  frame: ThumbFrame,
  vertical = false,
  kind: ThumbKind = "switch",
): Shape[] {
  if (frame.progress <= 0.001) return [];
  const rect = thumbLensRect(size, frame, vertical, kind);
  return [
    shape("thumb", rect, resolveRadii("capsule", rect), {
      alpha: Math.min(1, frame.progress),
      lift: frame.progress,
      magnify: 1 + (lensConfig.magnify - 1) * frame.progress,
    }),
  ];
}
