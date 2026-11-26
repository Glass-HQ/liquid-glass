import type {
  Appearance,
  BoxShadow,
  Material,
  MaterialKind,
  ProgressiveEdge,
  Rgba,
} from "../protocol";

/**
 * The glass materials.
 *
 * How the worker reads these numbers (render/shaders/glass.frag.glsl):
 * - `frost` is the Gaussian sigma of the blurred backdrop, CSS px, averaged on 4 px cells in a
 *   gamma that favours the lighter (light glass, 1.4) or darker (dark glass, 0.8) detail.
 * - The rim bends what is behind it inward: a point `depth` px inside the edge looks
 *   `pull × radius × (1 − depth / bezel)^falloff` px further in, red and blue split by
 *   `dispersion` of that.
 * - The face's tone on luma: `seen + lift + luma × (gain − curve × luma) − luma`, then
 *   saturation around the new luma. Light: black shows as 151 of 255, white as 253. Dark:
 *   black as 40, white as 170.
 * - Lighting: two thin specular rims from a light straight above (`shine`), a sheen just
 *   inside the lit edges, a faint shade inside the top and the flanks, and a hairline just
 *   outside the edge, darkest on the flanks.
 *
 * Clear glass is the same glass without frost and without tone: sharp, refracting, lit.
 */
export interface MaterialOptions {
  readonly kind: MaterialKind;
  readonly appearance: Appearance;
  /** Border box size, CSS px. */
  readonly width: number;
  readonly height: number;
  readonly tint: Rgba | null;
  /**
   * Glass that floats above the content (menus, popovers, dialogs) casts the deeper shadow
   * those cast.
   */
  readonly floating?: boolean;
  /** How tinted regular glass is (see `TintAmount`). Default: "default", 0.5. */
  readonly tintAmount?: TintAmount;
  /** A progressive blur instead of glass. */
  readonly edge?: ProgressiveEdge | null;
  /**
   * 0..1: how far the shadow has moved from resting glass's towards floating glass's, as a
   * button's does while it opens into a menu panel.
   */
  readonly shadowLift?: number;
}

/**
 * A progressive blur's frosts (Gaussian sigma, CSS px), lightest first. The blur moves through
 * them from its faint side to its strong one, so each is four times the last: close
 * enough that blending two neighbours reads as one blur in between.
 */
export const EDGE_FROSTS = [4, 16, 64] as const;

/**
 * How much of a progressive blur covers the page, at points along it from its faint side (0) to
 * its strong side (1). It is fully there well before the blur is strong, so the page's own
 * sharp content has gone while the two still look alike. The glass shader draws this curve; a
 * see-through page masks its content with what is left of it (`progressiveBlurMask`).
 */
export const EDGE_COVER_END = 0.4;
export const edgeCover = (along: number): number => {
  const t = Math.min(1, Math.max(0, along / EDGE_COVER_END));
  return t * t * (3 - 2 * t);
};

/**
 * How tinted regular glass is: from 0, "clear" (more of what is behind shows through, sharper), to 1, "tinted" (frostier, a
 * milkier face in light, a darker one in dark). "default" is 0.5. Only regular glass takes it: the clear material is a different glass, for
 * controls over media.
 */
export type TintAmount = number | "clear" | "default" | "tinted";

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** A `TintAmount` as a number in 0..1. */
export function tintAmountOf(amount: TintAmount | undefined): number {
  if (amount === "clear") return 0;
  if (amount === "tinted") return 1;
  if (amount === undefined || amount === "default" || !Number.isFinite(amount)) return 0.5;
  return clamp01(amount);
}

/** Frost (Gaussian sigma, CSS px) of clear glass on floating panels, which carry text. */
export const CLEAR_PANEL_FROST = 3;

/** 0 at a control's size (64 px and under), 1 at a panel's (160 px and over). */
export function panelAmount(size: number): number {
  return clamp01((size - 64) / 96);
}

/** The rim, shared by both materials and both appearances. */
const RIM = { bezel: 15, pull: 1 / 3, falloff: 2.5, dispersion: 0.22 } as const;

/**
 * Regular glass lets none of the sharp backdrop through: mixing it in at the rim read as clear
 * glass around a frosted middle. The material keeps the switch for experiments.
 */
const SHARP = {
  light: { sharp: 0, rimSharp: 0 },
  dark: { sharp: 0, rimSharp: 0 },
} as const;

/** The lighting, per appearance. */
const LIGHTING = {
  light: { shine: 0.125, sheen: 0.075, hairline: 0.34, hairlineCap: 0.3 },
  dark: { shine: 0.17, sheen: 0.055, hairline: 0.34, hairlineCap: 0 },
} as const;

/** Regular glass's face, per appearance, at tint amount 0.5. */
const FACE = {
  light: { frost: 10, lift: 151 / 255, gain: 0.4, curve: 0, saturation: 0.9 },
  dark: { frost: 10, lift: 40 / 255, gain: 0.85, curve: 0.34, saturation: 1.2 },
} as const;

export function resolveMaterial(options: MaterialOptions): Material {
  const { kind, appearance, tint } = options;
  const dark = appearance === "dark";
  const shorter = Math.max(1, Math.min(options.width, options.height));
  const panel = options.floating ? 1 : panelAmount(shorter);
  const lighting = LIGHTING[appearance];
  const lifted = clamp01(options.shadowLift ?? 0);
  const shadow = options.floating
    ? floatingShadow(dark)
    : lifted > 0
      ? mixShadow(restingShadow(panel), floatingShadow(dark), lifted)
      : restingShadow(panel);

  if (options.edge) {
    return {
      kind,
      appearance,
      frost: EDGE_FROSTS[EDGE_FROSTS.length - 1] ?? 0,
      bezel: 0,
      pull: 0,
      falloff: 1,
      dispersion: 0,
      sharp: 0,
      rimSharp: 0,
      lift: 0,
      gain: 1,
      curve: 0,
      saturation: 1,
      shine: 0,
      sheen: 0,
      hairline: 0,
      hairlineCap: 0,
      tint,
      dim: 0,
      shadow: null,
      edge: options.edge,
    };
  }

  if (kind === "clear") {
    return {
      kind,
      appearance,
      frost: options.floating ? CLEAR_PANEL_FROST : 0,
      ...RIM,
      sharp: 0,
      rimSharp: 0,
      lift: 0,
      gain: 1,
      curve: 0,
      saturation: 1,
      ...lighting,
      tint,
      dim: 0,
      shadow,
    };
  }

  // The amount moves the face around the default (its middle): towards less frost and a fainter
  // face at the clear end, more frost and a stronger face at the tinted end.
  const amount = tintAmountOf(options.tintAmount);
  const face = FACE[appearance];
  const t = amount - 0.5;
  return {
    kind,
    appearance,
    frost: face.frost * (1 + 0.8 * t),
    ...RIM,
    // The bend without color fringes: those are clear glass's.
    dispersion: 0,
    ...SHARP[appearance],
    lift: dark ? face.lift : clamp01(face.lift * (1 + 0.5 * t)),
    gain: dark ? face.gain * (1 - 0.3 * t) : face.gain,
    curve: face.curve,
    saturation: face.saturation,
    ...lighting,
    tint,
    dim: 0,
    shadow,
  };
}

/** Controls cast a faint, tight shadow; larger glass a softer, wider one. */
function restingShadow(panel: number): BoxShadow {
  const sigma = lerp(2.2, 12, panel);
  return {
    x: 0,
    y: lerp(7, 8, panel),
    blur: sigma * 2,
    spread: 0,
    color: [0, 0, 0, lerp(0.012, 0.06, panel)],
  };
}

function mixShadow(a: BoxShadow, b: BoxShadow, t: number): BoxShadow {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    blur: lerp(a.blur, b.blur, t),
    spread: lerp(a.spread, b.spread, t),
    color: [0, 0, 0, lerp(a.color[3], b.color[3], t)],
  };
}

/** An open panel's shadow. */
function floatingShadow(dark: boolean): BoxShadow {
  return { x: 0, y: 8, blur: 48, spread: 0, color: [0, 0, 0, dark ? 0.18 : 0.12] };
}

/**
 * How far a surface's drawing reaches past its border box: its shadow, and the ring a lifted
 * lens casts. Use it (rounded up) as the surface's bleed so nothing is cut off.
 */
export function materialReach(material: Material, lensHeight = 0): number {
  let reach = 2;
  const shadow = material.shadow;
  if (shadow && shadow.color[3] > 0) {
    const sigma = shadow.blur / 2;
    reach = Math.max(
      reach,
      2.5 * sigma + Math.max(Math.abs(shadow.x), Math.abs(shadow.y)) + Math.max(0, shadow.spread),
    );
  }
  if (lensHeight > 0) {
    const fit = Math.min(1.5, Math.max(0.25, lensHeight / 2 / 42));
    reach = Math.max(reach, 2.5 * 9 * fit + 6 * fit);
  }
  return Math.ceil(reach);
}
