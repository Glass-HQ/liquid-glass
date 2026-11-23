/**
 * The tab bar's selection, as a pure state machine: events in, one frame of shapes out.
 *
 * At rest a glass pill sits on the selected segment. A press lifts a lens out of it: the lens
 * grows to 1.5 times the pill and magnifies what is under it, while the pill fades beneath it
 * and the whole bar swells a little and brightens under the finger. Dragging carries the lens
 * after the finger on a soft spring; its speed squashes it along its path, and it wobbles when
 * the finger stops. A finger outside the bar pulls the bar after it through a rubber band, and
 * the bar squeezes across the pull. Letting go settles the lens on the nearest segment (or the
 * tapped one), the lift falls, the lens fades along an ease-out and the pill returns.
 *
 * The constants are in `constants.ts`. Segments can be of any width: the lens
 * position is its centre along the bar, and its rest size is interpolated between segments.
 */

import type { Radii, Rect, Shape } from "../protocol";
import type { Box, RadiusSpec } from "../core/geometry";
import { clamp, fromBox, resolveRadii, scaleRadii } from "../core/geometry";
import { createSpring, cubicBezier, springSet, springTo, stepSpring } from "../core/spring";
import type { Spring, SpringParams } from "../core/spring";
import {
  lens as config,
  segmentedDeform,
  segmentedLens,
  segmentedSquashAcross,
  tunedHz,
} from "./constants";
import { createDeform, deformMoving, squash, stepDeform } from "./deform";
import type { Deform } from "./deform";
import {
  createLift,
  createPressLight,
  liftMoving,
  liftPress,
  liftRelease,
  lightMoving,
  lightPress,
  lightRelease,
  stepLift,
  stepLight,
} from "./lift";
import type { Lift, PressLight } from "./lift";
import { shape } from "./shape";
import {
  createPull,
  followBar,
  pullMoving,
  pullRelease,
  pullToward,
  stepPull,
  stretchedBox,
} from "./stretch";
import type { Pull } from "./stretch";

export interface LensLayout {
  /** The bar in its own px, usually (0, 0, width, height). */
  readonly bar: Rect;
  /** Each segment's resting pill in bar px, in order along the bar. */
  readonly segments: readonly Rect[];
  /** Segments a drag must not settle on. */
  readonly disabled?: readonly boolean[];
  /** Device pixels per CSS px, for the drag slop. */
  readonly dpr: number;
}

export interface LensFrame {
  /** The bar, grown and stretched by the press. */
  readonly bar: Rect;
  readonly barLight: number;
  readonly pill: Rect;
  readonly pillAlpha: number;
  readonly lens: Rect;
  readonly lensAlpha: number;
  /** 0..1: how lifted the lens is (drives magnification and shadow). */
  readonly lift: number;
  readonly selected: number;
  readonly moving: boolean;
}

type Touch =
  | { readonly phase: "idle" }
  | { readonly phase: "pressed"; readonly index: number }
  | { readonly phase: "dragging"; readonly index: number }
  | { readonly phase: "settling" };

type PillState =
  | { readonly phase: "resting" }
  | { readonly phase: "following" }
  | { readonly phase: "returning"; readonly at: number; readonly from: number };

type LensPresence =
  | { readonly phase: "gone" }
  | { readonly phase: "shown" }
  | { readonly phase: "departing"; readonly at: number; readonly from: number };

interface State {
  selected: number;
  touch: Touch;
  finger: { originX: number; drag: number; reach: number; pointerY: number | null };
  /** The lens centre along the bar. */
  readonly x: Spring;
  readonly lift: Lift;
  liftBefore: number;
  readonly bar: {
    phase: "up" | "down";
    readonly pressed: Spring;
    readonly grow: Spring;
    readonly pull: Pull;
    readonly light: PressLight;
  };
  readonly presence: { pillState: PillState; lensState: LensPresence; pill: number; lens: number };
  readonly deform: Deform;
}

export interface LensMachine {
  /** New measurements. Without a touch the lens stays on the selected segment. */
  layout(layout: LensLayout): void;
  /** A finger or pointer went down on segment `index` at `point` (bar px). */
  press(index: number, point: { x: number; y: number }): void;
  /** The finger moved (bar px). */
  move(point: { x: number; y: number }): void;
  /**
   * The finger lifted. With `commit` the lens settles on the nearest segment after a drag, or
   * on the pressed one after a tap; without, it returns to the selection. Returns the segment
   * now selected.
   */
  release(commit: boolean): number;
  /** The selection changed from outside (keyboard, a controlled value). */
  select(index: number, animate?: boolean): void;
  /** Advance by `dt` seconds; `now` is performance.now() in ms. */
  advance(dt: number, now: number): LensFrame;
  readonly selected: number;
  readonly touching: boolean;
  readonly dragging: boolean;
}

/** The pill's growth when fully lifted, before the press share. */
const liftGrowth = (config.held - 1) * (1 - config.pressShare);

/**
 * "tabBar": a floating tab bar (the bar swells, the lens trails the finger on a soft spring and
 * squashes with speed). "segmented": a segmented control (`segmentedLens`).
 */
export type LensProfile = "tabBar" | "segmented";

export function createLensMachine(
  initial: LensLayout,
  selected: number,
  options: { reducedMotion?: () => boolean; profile?: LensProfile } = {},
): LensMachine {
  let layout = initial;
  const reduced = () => options.reducedMotion?.() ?? false;
  const quiet = options.profile === "segmented";
  const springs = quiet
    ? {
        lift: segmentedLens.lift,
        tap: segmentedLens.tap,
        snap: segmentedLens.snap,
        follow: segmentedLens.follow,
      }
    : { lift: config.lift, tap: config.tap, snap: config.snap, follow: config.follow };

  const centre = (index: number): number => {
    const seg = layout.segments[clamp(index, 0, Math.max(0, layout.segments.length - 1))];
    return seg ? seg.x + seg.width / 2 : layout.bar.x + layout.bar.width / 2;
  };
  const first = () => centre(0);
  const last = () => centre(layout.segments.length - 1);

  /** The resting pill size and vertical centre where the lens is, interpolated between segments. */
  const faceAt = (x: number): { width: number; height: number; y: number } => {
    const segs = layout.segments;
    const fallback = {
      width: layout.bar.height,
      height: layout.bar.height,
      y: layout.bar.y + layout.bar.height / 2,
    };
    if (segs.length === 0) return fallback;
    const at = (i: number) => {
      const s = segs[i] ?? segs[0]!;
      return { c: s.x + s.width / 2, width: s.width, height: s.height, y: s.y + s.height / 2 };
    };
    let lower = at(0);
    if (x <= lower.c || segs.length === 1) return lower;
    for (let i = 1; i < segs.length; i += 1) {
      const upper = at(i);
      if (x <= upper.c) {
        const t = upper.c > lower.c ? (x - lower.c) / (upper.c - lower.c) : 0;
        return {
          width: lower.width + (upper.width - lower.width) * t,
          height: lower.height + (upper.height - lower.height) * t,
          y: lower.y + (upper.y - lower.y) * t,
        };
      }
      lower = upper;
    }
    return lower;
  };

  const nearest = (x: number): number => {
    let best = state.selected;
    let distance = Infinity;
    layout.segments.forEach((_, i) => {
      if (layout.disabled?.[i]) return;
      const d = Math.abs(centre(i) - x);
      if (d < distance) {
        distance = d;
        best = i;
      }
    });
    return best;
  };

  const state: State = {
    selected,
    touch: { phase: "idle" },
    finger: { originX: 0, drag: 0, reach: 0, pointerY: null },
    x: createSpring(centre(selected)),
    lift: createLift(),
    liftBefore: 0,
    bar: {
      phase: "down",
      pressed: createSpring(0),
      grow: createSpring(0),
      pull: createPull(),
      light: createPressLight(),
    },
    presence: { pillState: { phase: "resting" }, lensState: { phase: "gone" }, pill: 1, lens: 0 },
    deform: createDeform("lens", quiet ? segmentedDeform : undefined),
  };

  const touching = () => state.touch.phase === "pressed" || state.touch.phase === "dragging";

  /** The bar follows the finger outside its edges. */
  const pullBar = () => {
    if (quiet) return;
    const { finger } = state;
    const point = {
      x: finger.originX + finger.drag,
      y: finger.pointerY ?? layout.bar.y + layout.bar.height / 2,
    };
    pullToward(state.bar.pull, point, layout.bar, springs.follow);
  };

  const settle = (index: number, spring: SpringParams) => {
    if (state.touch.phase === "dragging")
      state.touch = { phase: "pressed", index: state.touch.index };
    else if (state.touch.phase === "idle") state.touch = { phase: "settling" };
    state.selected = index;
    springTo(state.x, centre(index), spring);
    liftRelease(state.lift, springs.lift);
  };

  // ---------------------------------------------------------------------------------------------
  // Presence: the pill fades out as the lens lifts, and the lens fades out after the lift falls.
  // ---------------------------------------------------------------------------------------------

  const departure = (progress: number) =>
    cubicBezier(config.departure.curve, progress, config.departure.solveSteps);

  const stepPill = (lift: number, before: number, now: number) => {
    const p = state.presence;
    if (lift > before && lift > 0) p.pillState = { phase: "following" };
    else if (p.pillState.phase === "following" && lift < before && lift <= config.pillGoneAt)
      p.pillState = { phase: "returning", at: now, from: p.pill };
    const pill = p.pillState;
    if (pill.phase === "following") {
      p.pill = Math.max(0, 1 - lift / config.pillGoneAt);
      return;
    }
    if (pill.phase !== "returning") return;
    const progress = clamp((now - pill.at) / config.departure.durationMs, 0, 1);
    p.pill = pill.from + (1 - pill.from) * departure(progress);
    if (progress >= 1) p.pillState = { phase: "resting" };
  };

  const switchLens = (now: number) => {
    const p = state.presence;
    const shown = p.lensState.phase === "shown";
    const following = p.pillState.phase === "following";
    if (following && !shown) p.lensState = { phase: "shown" };
    else if (!following && shown) p.lensState = { phase: "departing", at: now, from: p.lens };
  };

  const stepLens = (strength: number, dt: number, now: number) => {
    const p = state.presence;
    const lensState = p.lensState;
    if (lensState.phase === "shown") {
      p.lens = Math.min(1, p.lens + config.presenceStep * dt * tunedHz);
      return;
    }
    if (lensState.phase !== "departing") return;
    const { durationMs, settledBelow, lingerDurations } = config.departure;
    const since = now - lensState.at;
    p.lens = Math.max(lensState.from * (1 - departure(clamp(since / durationMs, 0, 1))), strength);
    if (
      since >= durationMs &&
      (strength <= settledBelow || since >= durationMs * lingerDurations)
    ) {
      p.lens = 0;
      p.lensState = { phase: "gone" };
    }
  };

  const presenceMoving = () => {
    const p = state.presence;
    return (
      p.pillState.phase === "returning" ||
      p.lensState.phase === "departing" ||
      (p.lensState.phase === "shown" && p.lens < 1)
    );
  };

  // The bar is "up" while touched; it comes down once the lift starts falling.
  const stepBarPhase = (lift: number) => {
    const { bar } = state;
    if (touching()) {
      if (bar.phase === "up") return;
      bar.phase = "up";
      springTo(bar.pressed, 1, config.barPress);
    } else if (bar.phase === "up" && (lift <= 0 || lift < state.liftBefore)) {
      bar.phase = "down";
      springTo(bar.pressed, 0, config.barPress);
    }
  };

  return {
    get selected() {
      return state.selected;
    },
    get touching() {
      return touching();
    },
    get dragging() {
      return state.touch.phase === "dragging";
    },

    layout(next) {
      layout = next;
      state.selected = clamp(state.selected, 0, Math.max(0, next.segments.length - 1));
      // A resize must not animate the lens across the bar.
      if (!touching() && !state.x.active) springSet(state.x, centre(state.selected));
      else if (!touching())
        springTo(state.x, centre(state.selected), state.x.params ?? springs.tap);
    },

    press(index, point) {
      state.touch = { phase: "pressed", index };
      state.finger = { originX: point.x, drag: 0, reach: state.finger.reach, pointerY: null };
      if (!reduced()) {
        liftPress(state.lift, springs.lift);
        state.presence.pillState = { phase: "following" };
      }
      if (quiet) {
        // The bar holds still: no swell, no light.
        const target = centre(index);
        if (state.x.target !== target) springTo(state.x, target, springs.tap);
        return;
      }
      const target = centre(index);
      if (state.x.target !== target) springTo(state.x, target, springs.tap);
      lightPress(state.bar.light);
      springTo(state.bar.grow, 1, config.growRise);
    },

    move(point) {
      const touch = state.touch;
      if (touch.phase !== "pressed" && touch.phase !== "dragging") return;
      state.finger.pointerY = point.y;
      const index = touch.index;
      const displacement = point.x - state.finger.originX;
      const slop = quiet
        ? segmentedLens.followSlopPx
        : config.followSlopDevicePx / Math.max(1, layout.dpr);
      if (touch.phase === "pressed" && Math.abs(displacement) < slop) {
        pullBar();
        return;
      }
      state.touch = { phase: "dragging", index };
      state.finger.drag = displacement;
      state.finger.reach = clamp(centre(index) + displacement, first(), last());
      springTo(state.x, state.finger.reach, springs.follow);
      pullBar();
    },

    release(commit) {
      const touch = state.touch;
      const dragging = touch.phase === "dragging";
      const pressed = touch.phase === "pressed" || touch.phase === "dragging" ? touch.index : null;
      state.touch = { phase: "settling" };
      lightRelease(state.bar.light);
      springTo(state.bar.grow, 0, config.growFall);
      pullRelease(state.bar.pull, config.growFall);
      liftRelease(state.lift, springs.lift);
      if (!commit || pressed === null) {
        springTo(state.x, centre(state.selected), springs.tap);
        return state.selected;
      }
      if (dragging) {
        const index = nearest(centre(pressed) + state.finger.drag);
        settle(index, springs.snap);
      } else if (!layout.disabled?.[pressed]) settle(pressed, springs.tap);
      else springTo(state.x, centre(state.selected), springs.tap);
      return state.selected;
    },

    select(index, animate = true) {
      if (touching()) return;
      if (!animate || reduced()) {
        state.selected = index;
        springSet(state.x, centre(index));
        return;
      }
      if (index === state.selected && state.x.target === centre(index)) return;
      settle(index, springs.tap);
    },

    advance(dt, now) {
      stepLift(state.lift, dt, springs.lift);
      const lift = state.lift.value.value;
      stepPill(lift, state.liftBefore, now);
      stepBarPhase(lift);
      state.liftBefore = lift;
      stepSpring(state.x, dt);
      if (state.touch.phase === "settling" && !state.x.active) state.touch = { phase: "idle" };
      stepSpring(state.bar.pressed, dt);

      const dragging = state.touch.phase === "dragging";
      stepDeform(
        state.deform,
        dragging ? "reach" : "lens",
        dragging ? state.finger.reach : state.x.value,
        quiet ? dragging : lift > 0,
        dt,
      );
      switchLens(now);
      stepLight(state.bar.light, dt);

      const squashed = squash(state.deform.stretch, quiet ? segmentedSquashAcross : undefined);
      const x = state.x.value;
      const face = faceAt(x);
      let along: number;
      let across: number;
      let strength: number;
      if (quiet) {
        // The lens grows out of the pill by fixed shares of its height, so wide segments don't
        // grow wider lenses; it shows fully as soon as it lifts.
        along =
          (1 + (2 * segmentedLens.outsetAlong * face.height * lift) / Math.max(face.width, 1)) *
          squashed.x;
        across = (1 + 2 * segmentedLens.outsetAcross * lift) * squashed.y;
        strength = lift;
        state.presence.lens = lift > 0.001 ? 1 : 0;
        state.presence.pill = Math.max(0, 1 - lift);
      } else {
        const scale =
          1 +
          (config.held - 1) *
            ((1 - config.pressShare) * lift + config.pressShare * state.bar.pressed.value);
        along = scale * squashed.x;
        across = scale * squashed.y;
        strength = clamp((Math.max(along, across) - 1) / liftGrowth, 0, 1);
        stepLens(strength, dt, now);
      }

      stepSpring(state.bar.grow, dt);
      const growX = 1 + (config.pressWidth - 1) * state.bar.grow.value;
      const growY = 1 + (config.pressHeight - 1) * state.bar.grow.value;
      stepPull(state.bar.pull, dt);
      const bar = layout.bar;
      const shown = stretchedBox(bar, state.bar.pull, growX, growY);
      const barCx = bar.x + bar.width / 2;
      const barCy = bar.y + bar.height / 2;

      const lensBox: Box = followBar(
        {
          x: barCx + (x - barCx) * growX,
          y: face.y,
          width: face.width * along,
          height: face.height * across,
        },
        shown,
        bar,
        config.pressWidth,
        config.pressHeight,
      );
      const sx = shown.width / Math.max(bar.width, 1e-6);
      const sy = shown.height / Math.max(bar.height, 1e-6);
      const pillGrowth = quiet ? 1 : 1 + liftGrowth * lift;
      const pillBox: Box = {
        x: shown.x + (x - barCx) * sx,
        y: shown.y + (face.y - barCy) * sy,
        width: face.width * pillGrowth * sx,
        height: face.height * pillGrowth * sy,
      };

      const moving =
        pullMoving(state.bar.pull) ||
        state.bar.grow.active ||
        liftMoving(state.lift) ||
        state.x.active ||
        state.bar.pressed.active ||
        (!quiet && presenceMoving()) ||
        lightMoving(state.bar.light) ||
        (lift > 0 && deformMoving(state.deform));

      return {
        bar: fromBox(shown),
        barLight: state.bar.light.value,
        pill: fromBox(pillBox),
        pillAlpha: state.presence.pill,
        lens: fromBox(lensBox),
        lensAlpha: state.presence.lens,
        lift: strength,
        selected: state.selected,
        moving,
      };
    },
  };
}

/**
 * The shapes of one lens frame: the bar's body, the pill and the lens. A `segment` radius of
 * null makes the pill concentric with the bar: the bar's radius less the pill's inset from it.
 */
export function lensShapes(
  frame: LensFrame,
  radius: { bar: RadiusSpec; segment: RadiusSpec | null; restBar: Rect },
): Shape[] {
  // Numeric corners scale with the bar's growth so its shape is kept; capsules stay capsules.
  const barRadii =
    radius.bar === "capsule"
      ? resolveRadii("capsule", frame.bar)
      : scaleRadii(
          resolveRadii(radius.bar, radius.restBar),
          Math.min(
            frame.bar.width / Math.max(radius.restBar.width, 1e-6),
            frame.bar.height / Math.max(radius.restBar.height, 1e-6),
          ),
        );
  const shapes: Shape[] = [shape("body", frame.bar, barRadii, { light: frame.barLight })];
  if (frame.pillAlpha > 0.001)
    shapes.push(
      shape("pill", frame.pill, pillRadii(frame, barRadii, radius.segment), {
        alpha: frame.pillAlpha,
      }),
    );
  if (frame.lensAlpha > 0.001)
    shapes.push(
      shape("lens", frame.lens, resolveRadii("capsule", frame.lens), {
        alpha: frame.lensAlpha,
        lift: frame.lift,
        magnify: 1 + (config.magnify - 1) * frame.lift,
      }),
    );
  return shapes;
}

/** The pill's corners: as given, or the bar's less the pill's inset (concentric). */
function pillRadii(frame: LensFrame, barRadii: Radii, segment: RadiusSpec | null): Radii {
  if (segment !== null) return resolveRadii(segment, frame.pill);
  const { bar, pill } = frame;
  const inset = Math.max(0, Math.min(pill.y - bar.y, bar.y + bar.height - pill.y - pill.height));
  const half = Math.min(pill.width, pill.height) / 2;
  return [
    Math.min(half, Math.max(0, barRadii[0] - inset)),
    Math.min(half, Math.max(0, barRadii[1] - inset)),
    Math.min(half, Math.max(0, barRadii[2] - inset)),
    Math.min(half, Math.max(0, barRadii[3] - inset)),
  ];
}
