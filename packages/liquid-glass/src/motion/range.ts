/**
 * Slider value math. Its own module with no imports, so the React entry can place a slider's
 * thumb and fill on first render without loading the motion machines.
 */

export interface SliderRange {
  readonly min: number;
  readonly max: number;
  /** 0 or less for continuous. */
  readonly step: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/** A value kept in range and on a step (steps count from `min`). */
export function snapValue(value: number, { min, max, step }: SliderRange): number {
  if (!(max > min)) return min;
  let next = clamp(value, min, max);
  if (step > 0) {
    next = min + Math.round((next - min) / step) * step;
    // Undo float drift so 0.1 steps give 0.3, not 0.30000000000000004.
    const decimals = (String(step).split(".")[1] ?? "").length;
    next = clamp(Number(next.toFixed(decimals)), min, max);
  }
  return next;
}

/** 0..1 along the track for a value. */
export const valueFraction = (value: number, { min, max }: SliderRange): number =>
  max > min ? clamp((value - min) / (max - min), 0, 1) : 0;

/** The value at `along` px of a track `length` px long (from its start edge). */
export const valueAt = (along: number, length: number, range: SliderRange): number =>
  snapValue(
    range.min + (length > 0 ? clamp(along / length, 0, 1) : 0) * (range.max - range.min),
    range,
  );
