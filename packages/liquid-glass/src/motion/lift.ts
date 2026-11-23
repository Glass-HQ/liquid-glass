/**
 * Two small machines every pressed shape uses.
 *
 * - A lift rises to 1 while pressed and falls back after. A quick tap must still show the whole
 *   lift, so a release during the rise can wait for the peak before falling.
 * - A press light gathers in the glass under a finger and fades out after the release. A short
 *   tap lingers at full brightness for about one rise time, so it is visible at all.
 */

import { createSpring, springTo, stepRate, stepSpring } from "../core/spring";
import type { Spring } from "../core/spring";
import { peakAt, pressLight } from "./constants";
import type { LiftSprings } from "./constants";

export type LiftPhase = "resting" | "rising" | "peaked" | "waiting" | "falling";

export interface Lift {
  phase: LiftPhase;
  readonly value: Spring;
}

export const createLift = (): Lift => ({ phase: "resting", value: createSpring(0) });

const fall = (lift: Lift, springs: LiftSprings) => {
  lift.phase = "falling";
  springTo(lift.value, 0, springs.fall);
};

export function liftPress(lift: Lift, springs: LiftSprings): void {
  lift.phase = "rising";
  springTo(lift.value, 1, springs.rise);
}

export function liftRelease(lift: Lift, springs: LiftSprings): void {
  const rising = lift.phase === "rising" || lift.phase === "waiting";
  const peaked = springs.fallsIfPeakedOnRelease && lift.value.value >= peakAt;
  if (rising && !peaked) lift.phase = "waiting";
  else fall(lift, springs);
}

export function stepLift(lift: Lift, dt: number, springs: LiftSprings): void {
  stepSpring(lift.value, dt);
  const atPeak = lift.value.value >= peakAt;
  if (lift.phase === "rising" && atPeak) lift.phase = "peaked";
  else if (lift.phase === "waiting" && atPeak) fall(lift, springs);
  else if (lift.phase === "falling" && !lift.value.active) lift.phase = "resting";
}

export const liftMoving = (lift: Lift): boolean => lift.value.active || lift.phase === "waiting";

// ---------------------------------------------------------------------------------------------
// Press light
// ---------------------------------------------------------------------------------------------

type LightState =
  | { readonly phase: "idle" }
  | { readonly phase: "rising" }
  | { readonly phase: "full" }
  | { readonly phase: "finishing" }
  | { readonly phase: "lingering"; readonly wait: number; readonly waitRate: number }
  | { readonly phase: "falling" };

export interface PressLight {
  state: LightState;
  value: number;
  rate: number;
}

export const createPressLight = (): PressLight => ({ state: { phase: "idle" }, value: 0, rate: 0 });

export const lightPressed = (light: PressLight): boolean =>
  light.state.phase === "rising" || light.state.phase === "full";

export function lightPress(light: PressLight): void {
  light.state = { phase: "rising" };
}

export function lightRelease(light: PressLight): void {
  if (light.state.phase === "rising") light.state = { phase: "finishing" };
  else if (light.state.phase === "full") light.state = { phase: "lingering", wait: 0, waitRate: 0 };
}

export function lightMoving(light: PressLight): boolean {
  switch (light.state.phase) {
    case "rising":
    case "full":
      return (
        Math.abs(light.value - 1) > pressLight.restValue ||
        Math.abs(light.rate) > pressLight.restRate
      );
    case "lingering":
      return true;
    case "idle":
    case "finishing":
    case "falling":
      return light.value > 0;
  }
}

/** Rise towards full; true once there. */
const rise = (light: PressLight, dt: number): boolean => {
  const next = stepRate(light.value, light.rate, 1, pressLight.rise, dt);
  light.value = next.value;
  light.rate = next.rate;
  return light.value >= 1;
};

function sliceLight(light: PressLight, dt: number): void {
  const { state } = light;
  switch (state.phase) {
    case "idle":
      return;
    case "rising":
      if (rise(light, dt)) light.state = { phase: "full" };
      return;
    case "full":
      rise(light, dt);
      return;
    case "finishing":
      if (light.value <= 0) {
        light.state = { phase: "idle" };
        return;
      }
      if (rise(light, dt)) light.state = { phase: "falling" };
      return;
    case "lingering": {
      rise(light, dt);
      const wait = stepRate(state.wait, state.waitRate, 1, pressLight.rise, dt);
      light.state =
        wait.value >= 1
          ? { phase: "falling" }
          : { phase: "lingering", wait: wait.value, waitRate: wait.rate };
      return;
    }
    case "falling": {
      const next = stepRate(light.value, light.rate, 0, pressLight.fall, dt);
      const gone = next.value <= pressLight.gone;
      light.value = gone ? 0 : next.value;
      light.rate = gone ? 0 : next.rate;
      if (gone) light.state = { phase: "idle" };
      return;
    }
  }
}

/** The light is an explicit integrator, so it is stepped in fixed slices to read the same at any rate. */
export function stepLight(light: PressLight, dt: number): void {
  for (let left = dt; left > 0; left -= pressLight.slice)
    sliceLight(light, Math.min(pressLight.slice, left));
}
