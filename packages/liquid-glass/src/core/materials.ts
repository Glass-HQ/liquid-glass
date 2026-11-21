import type { GlassRadius } from "./shape.js";
/** Regular and Clear are the two glass styles macOS draws. Lens is the glass
 * a control's thumb turns into under a press: a clear magnifier with colored
 * fringes at its rim, showing the exact pixels under it. */
export type GlassMaterial = "clear" | "regular" | "lens";
export type GlassAppearance = "light" | "dark";
export interface MaterialOptions {
  material?: GlassMaterial;
  appearance?: GlassAppearance;
  radius?: GlassRadius;
  /** Follow the nearest shape container; radius controls independent corners. */
  concentric?: boolean | { inset?: number };
  /** How far the rim bends in what is behind it, in CSS pixels. Default: set
   * by the material and the glass's size, as on macOS. */
  refraction?: number;
  /** Optional color the glass is tinted with: a six-digit hex color such as
   * "#007aff", or in the DOM scene any CSS color, including a theme variable
   * like "var(--accent)", resolved where the glass is and followed as it
   * changes. Omit for untinted glass. */
  tint?: string;
  /** A moving highlight along the rim that follows the pointer, and the
   * device's tilt where the browser reports it. Default: false. */
  specular?: boolean;
  /** How frosted the glass is, from 0 (most see-through) to 1 (most frosted),
   * like the Liquid Glass slider in macOS's Appearance settings. Default: 0. */
  frost?: number;
  /** Glass that floats above the window, like a menu, popover or alert,
   * casts the deeper shadow macOS gives those. Default: false. */
  floating?: boolean;
  /** Colored fringes where a Lens bends what is behind it, as macOS draws on
   * a pressed switch or slider thumb. They triple the refraction work, so
   * they are off by default; pressed thumbs turn them on. */
  aberration?: boolean;
}

/**
 * Native glass changes with its size. macOS 27 derives every value of its
 * glass filter from the shorter side of the shape: controls up to 64 points
 * are nearly clear, and panels pick up frost, a darker face and a shadow as
 * they grow, fully from 160 points. Measured on `NSGlassEffectView` in an
 * active window at 31 sizes.
 */
/** The size glass takes its look from: its shorter side, in CSS pixels.
 * Floating glass (menus, popovers, dialogs) always looks like a panel, so a
 * short menu and a long one look alike. */
export function glassSize(o: MaterialOptions, width: number, height: number): number {
  const size = Math.min(width, height);
  return o.floating ? Math.max(size, 160) : size;
}
export function panelAmount(size: number): number {
  return Math.max(0, Math.min(1, (size - 64) / 96));
}
/** How far dark Regular glass has moved from a control's brightness ceiling
 * to a panel's: from 64 to 104 points. */
function ceilingAmount(size: number): number {
  return Math.max(0, Math.min(1, (size - 64) / 40));
}

/** The lens profile of the rim: how far it reaches in (`amount`) and how
 * deep the bend runs (`height`), both in CSS pixels, for a shape whose
 * shorter side is `size`. */
export interface Refraction {
  amount: number;
  height: number;
}
export function refractionFor(material: GlassMaterial, size: number): Refraction {
  const s = Math.max(1, size);
  if (material === "clear")
    return { amount: Math.min(0.65 * s, 60), height: Math.min(0.36 * s, 20) };
  // A lifted lens (a pressed switch or slider thumb, the tab bar's selection) bends hard
  // in a thin band at its rim, as macOS's does: 0.155 of its size, over its outer tenth. Its
  // middle shows what is beneath unbent, so only the rim carries color fringes.
  if (material === "lens") return { amount: 0.155 * s, height: 0.1 * s };
  return { amount: Math.min(s / 2, 60), height: Math.min(s / 4, 20) };
}
/** The most any glass bends, in CSS pixels. */
export const refraction = 60;

/** Colored fringes at a lens's rim: how far its red and blue channels part
 * from green, in CSS pixels. Only lenses that ask for them have them: macOS
 * shows them on a switch or slider's pressed thumb. */
export function aberrationFor(o: MaterialOptions, size: number): number {
  return o.material === "lens" && o.aberration ? 0.053 * size : 0;
}

/**
 * What glass does to the backdrop it sits on. The face reads the refracted
 * backdrop, lightly frosted (`blur`), and blends it with a softer copy of the
 * backdrop beneath it (`fill`): dark glass keeps the darker of the two, light
 * glass the lighter, so fine bright detail melts on dark glass and fine dark
 * detail on light glass while the rest stays sharp. Then saturation and a
 * tone curve shaped on luminance.
 */
export interface Calibration {
  /** Gaussian standard deviation of the frost, in CSS pixels. */
  blur: number;
  /** Gaussian standard deviation of the softer copy blended in, in CSS
   * pixels; 0 for none. */
  fill: number;
  /** How the softer copy combines: the share kept from the darker (dark) or
   * lighter (light) of the two, and the share of the softer copy laid over
   * everything, which the glass slider raises. */
  fillBlend: { mode: "darken" | "lighten"; amount: number; cover: number };
  /** Saturation applied before the tone curve. */
  saturation: number;
  /** Output (0..1, sRGB) of the tone curve for black, for the middle gray a
   * blurred checkerboard averages to (0.551), and for white. Above 1 clips. */
  tone: readonly [black: number, middle: number, white: number];
}
interface Stop {
  blur: number;
  fill: number;
  saturation: number;
  tone: readonly [number, number, number];
}
type Stops = Readonly<Record<GlassAppearance, readonly Stop[]>>;

/** Regular glass at a control's size (64 points and under) and at a panel's
 * (160 and over), along the glass slider at 0, 0.5 and 1. Brightness comes
 * from captures over black, gray and white, light and dark; frost from
 * captures over text and a photo. */
const regularControl: Stops = {
  dark: [
    { blur: 0.5, fill: 3, saturation: 1.15, tone: [0.125, 0.553, 0.725] },
    { blur: 0.5, fill: 6, saturation: 1.15, tone: [0.125, 0.446, 0.574] },
    { blur: 0.5, fill: 9, saturation: 1.15, tone: [0.125, 0.339, 0.424] },
  ],
  light: [
    { blur: 0.8, fill: 6, saturation: 1.5, tone: [0.4, 0.736, 0.992] },
    { blur: 0.8, fill: 8, saturation: 1.5, tone: [0.551, 0.803, 0.994] },
    { blur: 0.8, fill: 10, saturation: 1.5, tone: [0.702, 0.869, 0.996] },
  ],
};
const regularPanel: Stops = {
  dark: [
    { blur: 7.5, fill: 7.5, saturation: 1.6, tone: [0.125, 0.5, 0.573] },
    { blur: 8, fill: 8, saturation: 1.6, tone: [0.125, 0.4, 0.455] },
    { blur: 10, fill: 10, saturation: 1.6, tone: [0.125, 0.305, 0.337] },
  ],
  light: [
    { blur: 9, fill: 9, saturation: 1.8, tone: [0.408, 0.765, 1] },
    { blur: 11, fill: 11, saturation: 1.8, tone: [0.566, 0.83, 1] },
    { blur: 13, fill: 13, saturation: 1.8, tone: [0.725, 0.89, 1] },
  ],
};
// Clear keeps the backdrop sharp and lifts it (`0.125 + 0.955 x`) in either
// appearance and at any size; only the second half of the slider frosts it.
const clearRest: Stop = { blur: 0, fill: 0, saturation: 1.0, tone: [0.125, 0.651, 1.08] };
const clearFrosted: Stop = { blur: 12, fill: 0, saturation: 1.0, tone: [0.125, 0.651, 1.08] };
const clear: Stops = {
  dark: [clearRest, clearRest, clearFrosted],
  light: [clearRest, clearRest, clearFrosted],
};
// A magnifier passes the pixels under it unchanged, and the slider has no say.
const lensStop: Stop = { blur: 0, fill: 0, saturation: 1, tone: [0, 0.551, 1] };
const lens: Stops = { dark: [lensStop], light: [lensStop] };

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function along(stops: readonly Stop[], frost: number): Stop {
  if (stops.length === 1) return stops[0];
  const t = Math.max(0, Math.min(1, frost)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(t));
  return mix(stops[i], stops[i + 1], t - i);
}
function mix(a: Stop, b: Stop, k: number): Stop {
  return {
    blur: lerp(a.blur, b.blur, k),
    fill: lerp(a.fill, b.fill, k),
    saturation: lerp(a.saturation, b.saturation, k),
    tone: [
      lerp(a.tone[0], b.tone[0], k),
      lerp(a.tone[1], b.tone[1], k),
      lerp(a.tone[2], b.tone[2], k),
    ],
  };
}

/** The material's frost and tone for its options and size, where `size` is
 * the shorter side of the glass in CSS pixels. */
export function glassRecipe(o: MaterialOptions, size: number): Calibration {
  const material = o.material ?? "regular";
  const appearance = o.appearance ?? "light";
  const frost = Math.max(0, Math.min(1, o.frost ?? 0));
  let stop: Stop;
  if (material === "regular") {
    const control = along(regularControl[appearance], frost);
    const panel = along(regularPanel[appearance], frost);
    // Frost follows the panel amount; the dark face's ceiling settles sooner.
    const t = panelAmount(size);
    const toned = mix(control, panel, appearance === "dark" ? ceilingAmount(size) : t);
    stop = { ...toned, blur: lerp(control.blur, panel.blur, t) };
  } else stop = along((material === "clear" ? clear : lens)[appearance], frost);
  const dark = appearance === "dark";
  return {
    ...stop,
    fillBlend: {
      mode: dark ? "darken" : "lighten",
      // macOS keeps 0.675 of the blend at rest and 0.9 from halfway up the slider.
      amount: stop.fill ? 0.675 + 0.225 * Math.min(1, 2 * frost) : 0,
      cover: stop.fill ? frost : 0,
    },
  };
}

/** The shadow Regular glass casts outside its shape: a share of black over
 * what is behind it (`opacity`), falling off as a Gaussian of `blur` CSS
 * pixels from the edge, moved down by `dy`. Controls cast next to none;
 * panels and glass that floats above the window cast a soft, wide one. */
export interface GlassShadow {
  opacity: number;
  blur: number;
  dy: number;
}
export function shadowFor(o: MaterialOptions, size: number): GlassShadow | undefined {
  // A pressed thumb's lens rests on its track with a faint, tight ring.
  if (o.material === "lens") return { opacity: 0.12, blur: 3, dy: 1 };
  if ((o.material ?? "regular") !== "regular") return;
  const dark = (o.appearance ?? "light") === "dark";
  // Native glass darkens its surroundings toward 30% black, by its opacity.
  if (o.floating) return { opacity: 0.3 * (dark ? 0.8 : 0.6), blur: 24, dy: 10 };
  const t = panelAmount(size);
  const opacity = 0.3 * (dark ? 0.04 + 0.56 * t : 0.04 + 0.36 * t);
  return { opacity, blur: 4 + 20 * t, dy: 8 };
}
/** How far a shadow reaches past its shape, in CSS pixels. */
export function shadowReach(shadow: GlassShadow): number {
  return Math.ceil(2.5 * shadow.blur + Math.abs(shadow.dy));
}

/** How the outline just outside glass darkens what is behind it. A backdrop of
 * brightness x is covered by black at `rim × (base + slope × x)`, where `rim`
 * is the outline's strength from the map (0.47 where the edge faces sideways).
 * Most glass darkens mid gray by 47% and white by 24%; dark Regular glass
 * darkens bright backdrops more, controls a little and panels by up to 71%,
 * as measured on native glass over gray and white. */
export function outlineFor(o: MaterialOptions, size: number): { base: number; slope: number } {
  if ((o.material ?? "regular") === "regular" && (o.appearance ?? "light") === "dark") {
    const slope = 0.255 + (1.02 - 0.255) * panelAmount(size);
    return { base: 1 - 0.5 * slope, slope };
  }
  return { base: 1.5, slope: -1 };
}
