/**
 * Every number the motion machines use, in one place. Springs are (dampingRatio, response seconds).
 */

import type { SpringParams } from "../core/spring";
import { clamped } from "../core/spring";

/** The display rate the per-frame constants were tuned at. */
export const tunedHz = 120;

/** A lifted shape: rising, held at its peak, then falling. */
export interface LiftSprings {
  readonly rise: SpringParams;
  readonly fall: SpringParams;
  /**
   * Release while still rising: fall at once if the lift already peaked (true), or always
   * finish rising first so a quick tap still shows the whole lift (false).
   */
  readonly fallsIfPeakedOnRelease: boolean;
}

/** A lift counts as peaked at this value. */
export const peakAt = 0.99;

/** The light a press gathers in glass. Stepped in 1/120 s slices so it reads the same at any rate. */
export const pressLight = {
  rise: { dampingRatio: 0.8, response: 0.18 },
  fall: { dampingRatio: 1, response: 0.44 },
  slice: 1 / tunedHz,
  /** Below this the light is gone. */
  gone: 0.001,
  restValue: 5e-4,
  restRate: 0.005,
} as const;

/** Pulling glass past its edge with a finger. */
export const stretch = {
  /** Furthest the pull can move an edge, px. */
  limit: 5,
  resistance: 0.12,
  /** How much a pull along one axis squeezes the other. */
  squeeze: 0.08,
  /** px of stretch past the press growth over which a lens starts following the bar's stretch. */
  ease: 2,
} as const;

/**
 * A glass button under a press: it grows by 2.5 px across
 * its width whatever its size, keeping its proportions, on a quick, barely bouncy spring, and
 * stays where it is under a dragging pointer.
 */
export const press = {
  lift: {
    rise: { dampingRatio: 0.75, response: 0.16 },
    fall: { dampingRatio: 0.75, response: 0.26 },
    fallsIfPeakedOnRelease: true,
  } satisfies LiftSprings,
  /** Scale at full press of a 66 px button: 2.5 px. */
  scale: 1 + 2.5 / 66,
  /** How far a dragging pointer pulls the button after it, px. */
  pullLimit: 0,
  /** The size that scale was measured at; larger buttons grow by the same number of px. */
  measuredSize: 66,
  /** Every button grows by at least this much, px across its width. */
  minimumGrow: 2.5,
  follow: { dampingRatio: 0.75, response: 0.3 },
  settle: { dampingRatio: 0.62, response: 0.33 },
} as const;

/** The tab bar: a pill on the selected tab, lifted into a magnifying lens under a finger. */
export const lens = {
  lift: {
    rise: { dampingRatio: 1, response: 0.25 },
    fall: clamped({ dampingRatio: 1, response: 0.2 }),
    fallsIfPeakedOnRelease: true,
  } satisfies LiftSprings,
  /** Lens to a tapped tab. */
  tap: clamped({ dampingRatio: 0.8, response: 0.45 }),
  /** Lens to the nearest tab after a drag. */
  snap: clamped({ dampingRatio: 1, response: 0.3 }),
  /** Lens after a dragging finger, and the bar's pull. */
  follow: { dampingRatio: 0.75, response: 0.3 },
  /** The bar's share of the press. */
  barPress: { dampingRatio: 0.7, response: 0.34 },
  growRise: { dampingRatio: 0.62, response: 0.33 },
  growFall: { dampingRatio: 0.62, response: 0.33 },
  /** The bar while touched: this much wider and taller. */
  pressWidth: 1.047,
  pressHeight: 1.073,
  /** A held lens is this many times the pill. */
  held: 1.5,
  /** Of the lens growth, this share comes from the bar being pressed, the rest from the lift. */
  pressShare: 0.18,
  /** The pill is gone once the lift reaches this. */
  pillGoneAt: 0.5,
  /** The lens fades out along this curve when the lift falls. */
  departure: {
    curve: [0, 0, 0.58, 1] as const,
    durationMs: 150,
    lingerDurations: 8,
    settledBelow: 0.01,
    solveSteps: 24,
  },
  /** The lens fades in by this much per 1/120 s. */
  presenceStep: 0.2,
  /** A drag starts once the finger has moved this many device pixels. */
  followSlopDevicePx: 0.5,
  /**
   * Centre magnification of a fully lifted lens: none. The lens shows the exact pixels under it and bends only a thin band at its rim.
   */
  magnify: 1,
} as const;

export interface DeformParams {
  readonly spring: SpringParams;
  readonly fastAt: number;
  readonly fastest: number;
  readonly jolt: number;
  readonly narrowest: number;
  readonly widest: number;
  readonly paceSmoothing: number;
  readonly stepLongest: number;
  readonly stepShortest: number;
  readonly holdFrames: number;
  readonly intervalBlend: number;
  readonly startInterval: number;
  readonly restShape: number;
  readonly restRate: number;
  readonly restPace: number;
}

/**
 * The lens squashes along its path with speed and wobbles back when it stops: a spring whose
 * target is the smoothed speed, kicked the other way when the finger slows down.
 */
export const deform: DeformParams = {
  spring: { dampingRatio: 0.45, response: 0.28 },
  /** Speed (px/s) that counts as full speed. */
  fastAt: 1600,
  /** Stretch at full speed. */
  fastest: 0.275,
  /** The kick when slowing down. */
  jolt: 9.125,
  narrowest: -0.25,
  widest: 0.375,
  paceSmoothing: 0.03,
  stepLongest: 1 / 30,
  stepShortest: 1 / 240,
  /** Without a new sample for this many sample intervals the finger counts as stopped. */
  holdFrames: 2.5,
  intervalBlend: 0.2,
  startInterval: 1 / 120,
  restShape: 5e-4,
  restRate: 0.005,
  restPace: 5e-4,
} as const;

/**
 * The segmented control's selection: much quieter than the tab bar's. The bar holds still; the lens grows out of the pill by a third
 * of its height at each end and 1.58 times as tall, follows the pointer 1:1, squashes a little
 * only while dragged, and settles without overshoot in about 400 ms.
 */
export const segmentedLens = {
  lift: {
    rise: { dampingRatio: 1, response: 0.25 },
    fall: { dampingRatio: 1, response: 0.4 },
    fallsIfPeakedOnRelease: true,
  } satisfies LiftSprings,
  tap: { dampingRatio: 1, response: 0.4 },
  snap: { dampingRatio: 1, response: 0.4 },
  /** Close to 1:1: any gap to the pointer closes within a few frames. */
  follow: { dampingRatio: 1, response: 0.09 },
  /** The lens grows past the pill by these shares of the pill's height, on each side. */
  outsetAlong: 1 / 3,
  outsetAcross: 0.29,
  /** A drag starts once the pointer has moved this many CSS px. */
  followSlopPx: 3,
  magnify: 1,
} as const;

/** The segmented control's squash: small, and across it thins 2.4 times as much. */
export const segmentedDeform: DeformParams = {
  ...deform,
  spring: { dampingRatio: 0.55, response: 0.38 },
  fastAt: 529,
  fastest: 0.045,
  jolt: 0,
  narrowest: -0.03,
  widest: 0.045,
};
export const segmentedSquashAcross = 2.4;

/** A pill that follows the row under a pointer in lists and menus. */
export const highlight = {
  fade: { dampingRatio: 1, response: 0.28 },
  slide: { dampingRatio: 0.9, response: 0.15 },
} as const;

/** Switch and slider thumbs. */
export const thumb = {
  /** The switch thumb travels on this spring. */
  travel: { dampingRatio: 0.7, response: 0.47 },
  /** Lifting into a lens, and back, takes this long on an ease-in-out curve. */
  liftMs: 210,
  liftCurve: [0.42, 0, 0.58, 1] as const,
  /** A press shorter than this, released before half lifted, plays the tap envelope instead. */
  tapMs: 80,
  /** The switch's lens grows past the thumb by these fractions of the thumb's height, on each side. */
  growX: 0.45,
  growY: 0.275,
  /**
   * The slider's lens grows by this fraction of the thumb's own size on each side, both ways:
   * a 20 × 16 knob lifts to 25 × 20.
   */
  sliderGrow: 0.125,
  /** Speed stretches the lens up to this much along its path. */
  stretchMax: 0.025,
  stretchPerSpeed: 1e-4,
  /** Across its path the lens thins by this many times the stretch. */
  stretchAcross: 1.25,
  stretchSpring: { dampingRatio: 0.55, response: 0.3 },
  /** Dragging from the opposite half commits after this share of the width. */
  dragCommit: 0.4,
  /** A drag starts after this many px. */
  dragSlop: 3,
  /**
   * The lift of a short press, seconds from pointer down to (time, lift). It rises late,
   * peaks near 0.35 and is gone by 287 ms.
   */
  tapEnvelope: [
    [0, 0],
    [0.06, 0],
    [0.087, 0.120633],
    [0.103, 0.204144],
    [0.12, 0.280965],
    [0.137, 0.334618],
    [0.154, 0.353436],
    [0.17, 0.333683],
    [0.187, 0.281121],
    [0.204, 0.209108],
    [0.22, 0.133635],
    [0.237, 0.068474],
    [0.254, 0.02284],
    [0.27, 0.001445],
    [0.287, 0],
  ] as const,
} as const;
