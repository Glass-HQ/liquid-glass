/**
 * A switch: a thumb that springs between off and on (response 0.47 s, damping 0.7) and lifts into a lens while held.
 *
 * Dragging: a press on the thumb's own half flips the switch when the
 * finger crosses the middle; a press on the other half needs 40% of the width of travel. While
 * dragged, the thumb springs to the side the switch would land on, never sitting between.
 */

import { createSpring, springSet, springTo, stepSpring } from "../core/spring";
import { thumb as config } from "./constants";
import { createThumbMachine } from "./thumb";
import type { ThumbFrame } from "./thumb";

export interface SwitchLayout {
  /** The switch's width, px. */
  readonly width: number;
  /** How far the thumb travels from off to on, px. */
  readonly travel: number;
  readonly rtl: boolean;
}

export interface SwitchFrame extends ThumbFrame {
  /** 0 off, 1 on, anything between while it springs. */
  readonly position: number;
  /** The thumb's offset from its off place, px (negative in right-to-left). */
  readonly offset: number;
  /** The side to show as chosen: where a drag would land, else the checked state. */
  readonly on: boolean;
}

export interface SwitchMachine {
  layout(layout: SwitchLayout): void;
  /** The checked state from outside. Animated unless `animate` is false. */
  setChecked(checked: boolean, animate?: boolean): void;
  /** A press at `x` (px from the switch's left edge). */
  press(x: number, now: number): void;
  drag(x: number): void;
  /**
   * The press ended. With `commit`, returns the state the switch lands on: a drag lands where it
   * was taken, a tap toggles. Without, it returns to the current state and returns null.
   */
  release(commit: boolean, now: number): boolean | null;
  advance(dt: number, now: number): SwitchFrame;
  readonly pressed: boolean;
}

export function createSwitchMachine(
  checked: boolean,
  options: { reducedMotion?: () => boolean } = {},
): SwitchMachine {
  let layout: SwitchLayout = { width: 0, travel: 0, rtl: false };
  let current = checked;
  const position = createSpring(checked ? 1 : 0);
  const thumb = createThumbMachine(options);
  let drag: {
    x: number;
    start: boolean;
    oppositeHalf: boolean;
    moved: boolean;
    landing: boolean;
  } | null = null;
  const reduced = () => options.reducedMotion?.() ?? false;

  const goTo = (on: boolean) => {
    if (reduced()) springSet(position, on ? 1 : 0);
    else springTo(position, on ? 1 : 0, config.travel);
  };

  const landing = (x: number): boolean => {
    if (!drag) return current;
    if (!drag.oppositeHalf) return x >= layout.width / 2 !== layout.rtl;
    const delta = (x - drag.x) * (layout.rtl ? -1 : 1);
    return drag.start
      ? delta >= -layout.width * config.dragCommit
      : delta > layout.width * config.dragCommit;
  };

  return {
    get pressed() {
      return thumb.pressed;
    },
    layout(next) {
      layout = next;
    },
    setChecked(next, animate = true) {
      current = next;
      if (drag) return;
      if (animate) goTo(next);
      else springSet(position, next ? 1 : 0);
    },
    press(x, now) {
      const half = x >= layout.width / 2 !== layout.rtl;
      drag = { x, start: current, oppositeHalf: half !== current, moved: false, landing: current };
      thumb.press(now);
    },
    drag(x) {
      if (!drag) return;
      drag.moved ||= Math.abs(x - drag.x) > config.dragSlop;
      if (!drag.moved) return;
      const next = landing(x);
      if (next !== drag.landing) {
        drag.landing = next;
        goTo(next);
      }
    },
    release(commit, now) {
      const ended = drag;
      drag = null;
      thumb.release(now);
      if (!ended || !commit) {
        goTo(current);
        return null;
      }
      const result = ended.moved ? ended.landing : !current;
      goTo(result);
      return result;
    },
    advance(dt, now) {
      const moving = stepSpring(position, dt);
      const offset = position.value * layout.travel * (layout.rtl ? -1 : 1);
      const frame = thumb.advance(dt, now, offset);
      return {
        ...frame,
        position: position.value,
        offset,
        on: drag?.moved ? drag.landing : current,
        moving: moving || frame.moving,
      };
    },
  };
}
