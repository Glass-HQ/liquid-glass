import type { Appearance, BackdropReading, Material, MaterialKind } from "../protocol";

/**
 * How glass adapts to what is behind it, so what sits on it stays readable. The worker measures
 * each surface's backdrop (mean luma, variation, bright share; `BackdropReading`) and the page
 * decides:
 *
 * - Regular glass is adaptive. Small pieces (controls, toolbars, tab bars) flip between light
 *   and dark glass with what is behind them, and so do the symbols and text on them. Large
 *   pieces (panels, menus, sidebars, anything floating) never flip: the transition would be
 *   distracting over that much area. Every regular piece casts a stronger shadow over text and
 *   a lighter one over a flat light background.
 * - Clear glass has no adaptive look of its own: it stays transparent and needs a dimming layer
 *   between it and bright content for what is on it (bright, bold symbols and text) to read.
 *   That layer is black, up to 35% over bright content and none over dark content, applied by the glass itself, in proportion to how bright the content is.
 *
 * Everything is pure: a state goes in with the time step, the next state comes out.
 */

/** A backdrop reading without its surface id (see `BackdropReading`). */
export type BackdropLevels = Omit<BackdropReading, "id">;

const LEVEL_KEYS = ["luma", "contrast", "bright", "detail"] as const;

export interface AdaptState {
  /** The latest reading from the worker, or null before the first. */
  readonly target: BackdropLevels | null;
  /** What the glass shows now: eases toward `target`. */
  readonly shown: BackdropLevels | null;
  /** The resolved tone: dark glass (light labels) or light glass (dark labels). */
  readonly tone: Appearance;
  /** 0 = light glass, 1 = dark glass; eases toward `tone` (the flip's crossfade). */
  readonly mix: number;
}

export interface AdaptInput {
  readonly kind: MaterialKind;
  /** The appearance the surface would have without adapting (the scene's or its own). */
  readonly appearance: Appearance;
  /** Whether the surface may flip (regular, small, not floating, appearance not pinned). */
  readonly flips: boolean;
}

/**
 * When small regular glass flips: each appearance has a band of mean luma. Below the band the glass is dark, above it light, inside
 * it keeps what it was. Light mode glass turns dark only over very dark content (under 0.1) and
 * back over 0.3; dark mode glass turns light only over very bright content (over 0.9) and back
 * under 0.7.
 */
export const HYSTERESIS: Readonly<Record<Appearance, readonly [low: number, high: number]>> = {
  light: [0.1, 0.3],
  dark: [0.7, 0.9],
};
/** The dimming layer for clear glass over bright content. */
export const CLEAR_DIM = 0.35;
/**
 * Extra dimming for clear glass over busy content (text, fine detail) with bright parts: its
 * bright strokes compete with the bright labels whatever the mean. Up to 0.6 in all.
 */
export const CLEAR_BUSY_DIM = 0.25;
/** Frost (Gaussian sigma, CSS px) clear glass takes over dense text. */
export const CLEAR_DETAIL_FROST = 3;
/** Regular glass's shadow: how much stronger over text, how much lighter over flat light. */
export const SHADOW_OVER_TEXT = 1.5;
export const SHADOW_OVER_LIGHT = 0.5;
/**
 * Seconds for readings to settle into the glass (an exponential ease with this time constant),
 * and for the flip's cross-fade.
 */
const SETTLE_S = 0.29;
const FLIP_S = 0.3;

/**
 * Glass up to this size on its shorter side counts as small (controls, toolbars, tab bars);
 * anything taller is a panel, menu or sidebar and never flips.
 */
const SMALL_SIZE = 88;

export function initialAdapt(appearance: Appearance): AdaptState {
  return { target: null, shown: null, tone: appearance, mix: appearance === "dark" ? 1 : 0 };
}

/** Whether a regular surface of this size flips light/dark with its backdrop. */
export function isSmall(width: number, height: number, floating: boolean): boolean {
  if (floating) return false;
  return Math.min(width, height) <= SMALL_SIZE;
}

export function readingLevels(reading: BackdropReading): BackdropLevels {
  return {
    luma: reading.luma,
    contrast: reading.contrast,
    bright: reading.bright,
    detail: reading.detail,
  };
}

/**
 * The tone labels on the glass should take. Regular glass that doesn't flip keeps its
 * appearance. Small regular glass flips with hysteresis. Clear glass carries light labels
 * (its content is meant to be bright) except over flat, light content, where dark labels read
 * without any dimming.
 */
export function resolveTone(
  input: AdaptInput,
  levels: BackdropLevels | null,
  previous: Appearance,
): Appearance {
  if (!levels) return input.kind === "clear" ? clearTone(input.appearance, null) : input.appearance;
  if (input.kind === "clear") return clearTone(previous, levels);
  if (!input.flips) return input.appearance;
  const [low, high] = HYSTERESIS[input.appearance];
  if (levels.luma > high) return "light";
  if (levels.luma < low) return "dark";
  return previous;
}

function clearTone(previous: Appearance, levels: BackdropLevels | null): Appearance {
  if (!levels) return previous;
  // Flat and light: a white page, a light card. Busy or darker content gets light labels and,
  // as it brightens, the dimming layer.
  const flatLight = levels.luma > 0.7 && levels.contrast < 0.22;
  const leaveFlatLight = levels.luma < 0.6 || levels.contrast > 0.32;
  if (previous === "light") return leaveFlatLight ? "dark" : "light";
  return flatLight ? "light" : "dark";
}

/**
 * Whether a new backdrop reading differs enough from the current one to act on. Below this the
 * adapted glass would change by less than a visible step, so the reading is dropped and the
 * surface keeps its pixels (and partial redraws stay partial).
 */
export function meaningfulChange(current: BackdropLevels | null, next: BackdropLevels): boolean {
  if (!current) return true;
  return LEVEL_KEYS.some((key) => Math.abs(next[key] - current[key]) > READING_DEAD_BAND);
}

const READING_DEAD_BAND = 0.03;

/** Advance one frame of `dt` seconds. Returns the next state and whether it is still moving. */
export function stepAdapt(
  state: AdaptState,
  input: AdaptInput,
  dt: number,
  reducedMotion: boolean,
): { state: AdaptState; moving: boolean } {
  const seconds = Math.max(0, Math.min(dt, 0.1));
  const target = state.target;
  let shown = state.shown;
  let moving = false;
  if (target) {
    if (!shown || reducedMotion) shown = target;
    else {
      const k = 1 - Math.exp(-seconds / SETTLE_S);
      const from = shown;
      const next = { ...from };
      for (const key of LEVEL_KEYS) next[key] = from[key] + (target[key] - from[key]) * k;
      if (LEVEL_KEYS.some((key) => Math.abs(next[key] - target[key]) > 0.004)) {
        shown = next;
        moving = true;
      } else shown = target;
    }
  }
  // Decide on the target (the decision shouldn't lag the reading), show it with the crossfade.
  const tone = resolveTone(input, target ?? shown, state.tone);
  // Clear glass's tone only picks label colors; the glass itself doesn't change.
  const glassTone = input.kind === "clear" || !input.flips ? input.appearance : tone;
  const want = glassTone === "dark" ? 1 : 0;
  let mix = state.mix;
  if (reducedMotion || !input.flips) mix = want;
  else if (mix !== want) {
    const step = seconds / FLIP_S;
    mix = want > mix ? Math.min(want, mix + step) : Math.max(want, mix - step);
    if (mix !== want) moving = true;
  }
  return { state: { target, shown, tone, mix }, moving };
}

/** Cross-fade two materials resolved for light and dark glass: `mix` 0 is `light`. */
export function mixMaterials(light: Material, dark: Material, mix: number): Material {
  if (mix <= 0) return light;
  if (mix >= 1) return dark;
  // Ease in and out, so the flip doesn't start or stop abruptly.
  const t = mix * mix * (3 - 2 * mix);
  const lerp = (a: number, b: number) => a + (b - a) * t;
  const shadow =
    light.shadow && dark.shadow
      ? {
          x: lerp(light.shadow.x, dark.shadow.x),
          y: lerp(light.shadow.y, dark.shadow.y),
          blur: lerp(light.shadow.blur, dark.shadow.blur),
          spread: lerp(light.shadow.spread, dark.shadow.spread),
          color: [0, 0, 0, lerp(light.shadow.color[3], dark.shadow.color[3])] as const,
        }
      : t < 0.5
        ? light.shadow
        : dark.shadow;
  return {
    ...(t < 0.5 ? light : dark),
    frost: lerp(light.frost, dark.frost),
    bezel: lerp(light.bezel, dark.bezel),
    pull: lerp(light.pull, dark.pull),
    falloff: lerp(light.falloff, dark.falloff),
    sharp: lerp(light.sharp, dark.sharp),
    rimSharp: lerp(light.rimSharp, dark.rimSharp),
    lift: lerp(light.lift, dark.lift),
    gain: lerp(light.gain, dark.gain),
    curve: lerp(light.curve, dark.curve),
    saturation: lerp(light.saturation, dark.saturation),
    shine: lerp(light.shine, dark.shine),
    sheen: lerp(light.sheen, dark.sheen),
    hairline: lerp(light.hairline, dark.hairline),
    hairlineCap: lerp(light.hairlineCap, dark.hairlineCap),
    dim: lerp(light.dim, dark.dim),
    shadow,
  };
}

/**
 * The backdrop-dependent parts of a material: clear glass's dimming layer, and the shadow of
 * regular glass, stronger over text and lighter over a flat light background.
 */
export function adaptMaterial(
  material: Material,
  levels: BackdropLevels | null,
  tone: Appearance,
): Material {
  if (!levels) return material;
  // Fine detail (running text) is what makes glass hard to read through: 0 over flat color and
  // photos, 1 over dense text.
  const busy = smoothstep(0.1, 0.4, levels.detail);
  if (material.kind === "clear") {
    // Clear glass over text diffuses it a little, so letters behind don't read as letters next to the labels.
    const frost = Math.max(material.frost, frostSteps(CLEAR_DETAIL_FROST * busy));
    // Dark labels over flat light content (the "light" tone) need no dimming layer.
    if (tone === "light") return quantized({ ...material, frost });
    // Bright content needs the layer, dark content doesn't. Brightness counts the bright share
    // twice, so white text on black (a dark mean, bright strokes) is dimmed too; busy content
    // with bright strokes, which compete with the bright labels, gets a deeper layer.
    const brightness = Math.max(levels.luma, 2 * levels.bright);
    const dim =
      CLEAR_DIM * smoothstep(0.3, 0.75, brightness) +
      CLEAR_BUSY_DIM * busy * smoothstep(0.03, 0.2, levels.bright);
    return quantized({ ...material, frost, dim });
  }
  // Regular glass already frosts enough to keep letters behind from reading as letters.
  const ranged = material;
  const shadow = ranged.shadow;
  if (!shadow) return quantized(ranged);
  // Regular glass: a stronger shadow over text, a lighter one over a flat light background.
  const flatLight = levels.luma * (1 - busy) * (1 - smoothstep(0.1, 0.4, levels.contrast));
  const scale =
    (1 + SHADOW_OVER_TEXT * busy) * (1 - SHADOW_OVER_LIGHT * smoothstep(0.6, 0.95, flatLight));
  return quantized({
    ...ranged,
    shadow: { ...shadow, color: [0, 0, 0, Math.min(1, shadow.color[3] * scale)] },
  });
}

/**
 * Adapted values change a little with every reading; rounding them keeps a surface from being
 * redrawn (and re-presented) for changes nobody can see.
 */
function quantized(material: Material): Material {
  const step = (x: number, by: number) => Math.round(x / by) * by;
  const shadow = material.shadow;
  return {
    ...material,
    dim: step(material.dim, 1 / 128),
    shadow: shadow ? { ...shadow, color: [0, 0, 0, step(shadow.color[3], 1 / 128)] } : null,
  };
}

/**
 * Frost from adapting moves in steps of 1.5 px: each sigma is a frost computed and cached of
 * its own, so a reading easing in shouldn't visit every half pixel on its way.
 */
function frostSteps(sigma: number): number {
  return Math.round(sigma / 1.5) * 1.5;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
