/**
 * A slider: the thumb follows the finger one to one and lifts into a lens while held (the same
 * lift as the switch thumb). Values snap to `step`; the thumb shows the snapped value.
 */

import { createThumbMachine } from "./thumb";
import type { ThumbFrame } from "./thumb";

export { snapValue, valueAt, valueFraction } from "./range";
export type { SliderRange } from "./range";

export interface SliderMachine {
  press(now: number): void;
  release(now: number): void;
  /** `position` is the thumb's place along the track, px. */
  advance(dt: number, now: number, position: number): ThumbFrame;
  readonly pressed: boolean;
}

export const createSliderMachine = (
  options: { reducedMotion?: () => boolean } = {},
): SliderMachine => createThumbMachine(options);
