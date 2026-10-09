import { materials } from "../core/materials.js";
import type { MaterialOptions } from "../core/materials.js";

/** Filter passes shared by every renderer of one lens: the frosted backdrop
 * of Regular glass, the calibrated tone of each material, and tint. Each
 * names its results after the lens prefix `p`. */
const dark = (o: MaterialOptions) => o.appearance === "dark";

/** Regular glass refracts a frosted copy of its backdrop: a blur lightened
 * (darkened in dark appearance) by a wider fill blur. */
export function frostMarkup(p: string, input: string, o: MaterialOptions, soften = 1): { markup: string; result: string } {
  const spec = dark(o) ? materials.regular.dark : materials.regular.light;
  return {
    markup: `<feGaussianBlur in="${input}" stdDeviation="${materials.regular.blur * soften}" result="${p}frost"/><feGaussianBlur in="${input}" stdDeviation="${spec.fillSigma * soften}" result="${p}fill"/><feBlend in="${p}frost" in2="${p}fill" mode="${dark(o) ? "darken" : "lighten"}" result="${p}blend"/><feComposite in="${p}blend" in2="${p}frost" operator="arithmetic" k2="${spec.fillOpacity}" k3="${1 - spec.fillOpacity}" result="${p}mix"/>`,
    result: `${p}mix`,
  };
}

/** The material's tone curve applied to `${p}refracted`, written to `${p}color`. */
export function toneMarkup(p: string, o: MaterialOptions, nested: boolean): string {
  if (o.material === "regular") {
    const spec = dark(o) ? materials.regular.dark : materials.regular.light;
    // SVG's per-channel transfer is a calibrated tone curve, then a chroma matrix.
    const [a, b, q, chroma] = spec.tone;
    const table = Array.from({ length: 33 }, (_, n) => {
      const v = n / 32;
      const toned = a + b * v + q * v * v;
      const toneWeight = dark(o) ? 0.90 : 0.80;
      return toneWeight * toned + (1 - toneWeight) * v;
    }).join(" ");
    return `<feComponentTransfer in="${p}refracted" result="${p}tone"><feFuncR type="table" tableValues="${table}"/><feFuncG type="table" tableValues="${table}"/><feFuncB type="table" tableValues="${table}"/></feComponentTransfer><feColorMatrix in="${p}tone" type="saturate" values="${chroma}" result="${p}color"/>`;
  }
  const spec = dark(o) ? materials.clear.dark : materials.clear.light;
  // A second dark layer needs a distinct light response, rather than
  // converging on the same tone as the containing surface.
  const table = Array.from({ length: 33 }, (_, n) => {
    const v = n / 32;
    const tone = v + spec.shadowLift * (1 - v) ** 3 - spec.highlightRolloff * v ** 3;
    // Keep a subtle broad tint, with less veil in light appearance
    // and a slightly stronger pale response in dark appearance.
    const tinted = dark(o) ? 0.38 * v + 0.20 : 0.78 * v + 0.26;
    const tintWeight = dark(o) ? 0.14 : 0.06;
    const layerLight = dark(o) && nested ? 0.08 * (1 - v) : 0;
    return Math.max(0, Math.min(1, (1 - tintWeight) * tone + tintWeight * tinted + layerLight));
  }).join(" ");
  return `<feComponentTransfer in="${p}refracted" result="${p}color"><feFuncR type="table" tableValues="${table}"/><feFuncG type="table" tableValues="${table}"/><feFuncB type="table" tableValues="${table}"/></feComponentTransfer>`;
}

/** Tint as linear RGB channels, when it is a hex color. */
export function tintChannels(o: MaterialOptions): number[] | undefined {
  return o.tint && /^#[\da-f]{6}$/i.test(o.tint)
    ? [1, 3, 5].map((offset) => parseInt(o.tint!.slice(offset, offset + 2), 16) / 255)
    : undefined;
}

/** Colored glass transmits luminance, rather than mixing neutral backdrop RGB
 * into a weak overlay. A pale backdrop can brighten the pigment without
 * removing its chroma; dark detail stays visible. Reads `${p}color`. */
export function tintMarkup(p: string, o: MaterialOptions, tint: number[]): { markup: string; color: string } {
  const body = o.material === "regular" ? 0.78 : 0.68;
  const channels = ["R", "G", "B"];
  return {
    markup: `<feColorMatrix in="${p}color" type="saturate" values="0" result="${p}luminance"/>`
      + `<feComponentTransfer in="${p}luminance" result="${p}tinted">${channels.map((channel, index) => `<feFunc${channel} type="linear" slope="${tint[index]! * (1 - body)}" intercept="${tint[index]! * body}"/>`).join("")}<feFuncA type="linear" slope="${1 - body}" intercept="${body}"/></feComponentTransfer>`,
    color: `${p}tinted`,
  };
}

/** The overlay's light is white (0.82 in dark appearance) over a black rim.
 * Scaling its color recolors the light alone and keeps the coverage the WGSL
 * renderer computed. */
export function overlayTintMarkup(input: string, result: string, o: MaterialOptions, tint: number[]): string {
  const light = dark(o) ? 0.82 : 1;
  return `<feComponentTransfer in="${input}" result="${result}">${["R", "G", "B"].map((channel, index) => `<feFunc${channel} type="linear" slope="${(0.45 + 0.55 * tint[index]!) / light}"/>`).join("")}</feComponentTransfer>`;
}
