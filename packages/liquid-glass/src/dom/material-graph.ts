import { glassRecipe, shadowReach } from "../core/materials.js";
import type { GlassShadow, MaterialOptions } from "../core/materials.js";

/** Filter passes shared by every renderer of one lens: the frosted backdrop,
 * the calibrated tone of each material, and tint. Each names its results
 * after the lens prefix `p`. */

/** The scene's backdrop color: what glass treats as behind it wherever the
 * content is transparent. It resolves where the glass draws, so a theme
 * changing `--lg-backdrop` recolors the glass without a new filter. */
export const backdropColor = "var(--lg-backdrop, transparent)";

/** Whether a computed `--lg-backdrop` paints anything. Unset, it is empty
 * (or transparent, once the stylesheet registers it as a color), and the
 * glass is drawn exactly as without a backdrop. */
export function hasBackdrop(value: string): boolean {
  const v = value.trim().toLowerCase();
  return !(
    v === "" ||
    v === "transparent" ||
    /^rgba\((?:[^,()]*,){3}\s*0(?:\.0*)?\s*\)$/.test(v) ||
    /\/\s*0(?:\.0*)?%?\s*\)$/.test(v)
  );
}

/** The backdrop color across `box`, named `result`. */
export function backdropMarkup(
  result: string,
  box: { x: number; y: number; width: number; height: number },
): string {
  return `<feFlood style="flood-color:${backdropColor}" x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" result="${result}"/>`;
}

/** Glass refracts a lightly frosted copy of its backdrop: one blur, as wide
 * as the material, its size and its frost call for. Glass with no frost reads
 * its backdrop directly. */
export function frostMarkup(
  p: string,
  input: string,
  o: MaterialOptions,
  size: number,
  soften = 1,
): { markup: string; result: string } {
  const blur = glassRecipe(o, size).blur * soften;
  if (blur < 0.05) return { markup: "", result: input };
  return {
    markup: `<feGaussianBlur in="${input}" stdDeviation="${blur}" result="${p}mix"/>`,
    result: `${p}mix`,
  };
}

/** Refract `input` through the lens's field map by `amount` CSS pixels at
 * the rim, into `${p}refracted`. With `aberration`, red bends that much
 * further and blue that much less than green, so a lens shows colored
 * fringes where it bends, as a pressed control's thumb does on macOS. */
export function refractMarkup(p: string, input: string, amount: number, aberration = 0): string {
  const displace = (travel: number, result: string) =>
    `<feDisplacementMap in="${input}" in2="${p}field" scale="${travel * 2}" xChannelSelector="R" yChannelSelector="G" result="${result}"/>`;
  if (!(aberration >= 0.05)) return displace(amount, `${p}refracted`);
  const only = (from: string, row: number, result: string) => {
    const rows = [0, 1, 2].map((r) =>
      r === row ? [r === 0 ? 1 : 0, r === 1 ? 1 : 0, r === 2 ? 1 : 0, 0, 0] : [0, 0, 0, 0, 0],
    );
    return `<feColorMatrix in="${from}" type="matrix" values="${[...rows.flat(), 0, 0, 0, 1, 0].join(" ")}" result="${result}"/>`;
  };
  // Each channel keeps its own coverage; the sum's coverage clamps to the
  // widest, which for opaque content is the content's own.
  return (
    displace(amount + aberration, `${p}refractedR`) +
    displace(amount, `${p}refractedG`) +
    displace(Math.max(0, amount - aberration), `${p}refractedB`) +
    only(`${p}refractedR`, 0, `${p}red`) +
    only(`${p}refractedG`, 1, `${p}green`) +
    only(`${p}refractedB`, 2, `${p}blue`) +
    `<feComposite in="${p}red" in2="${p}green" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="${p}redGreen"/>` +
    `<feComposite in="${p}redGreen" in2="${p}blue" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="${p}refracted"/>`
  );
}

/** The softer copy of the backdrop Regular glass blends with its refracted
 * face, read from `backdrop` where the glass is, unrefracted: dark glass keeps
 * the darker of the two and light glass the lighter, then the glass slider
 * lays more of the softer copy over the whole face. Returns `refracted`
 * unchanged for glass without one. */
export function fillMarkup(
  p: string,
  refracted: string,
  backdrop: string,
  o: MaterialOptions,
  size: number,
  soften = 1,
  frosted?: string,
): { markup: string; result: string } {
  const { blur, fill, fillBlend } = glassRecipe(o, size);
  if (!fill || !fillBlend.amount) return { markup: "", result: refracted };
  const keep = fillBlend.amount,
    cover = fillBlend.cover;
  // As soft as the frost, the softer copy is the frost itself.
  const reuse = frosted && Math.abs(fill - blur) < 0.01;
  const softer = reuse ? frosted : `${p}fill`;
  const parts = [
    ...(reuse
      ? []
      : [`<feGaussianBlur in="${backdrop}" stdDeviation="${fill * soften}" result="${p}fill"/>`]),
    `<feBlend in="${refracted}" in2="${softer}" mode="${fillBlend.mode}" result="${p}blend"/>`,
    `<feComposite in="${p}blend" in2="${refracted}" operator="arithmetic" k1="0" k2="${keep * (1 - cover)}" k3="${(1 - keep) * (1 - cover)}" k4="0" result="${p}blended"/>`,
  ];
  if (cover > 0)
    parts.push(
      `<feComposite in="${p}blended" in2="${softer}" operator="arithmetic" k1="0" k2="1" k3="${cover}" k4="0" result="${p}covered"/>`,
    );
  return { markup: parts.join(""), result: cover > 0 ? `${p}covered` : `${p}blended` };
}

/** The input the tone curve receives from a blurred checkerboard of black and
 * white squares: the middle point it is calibrated at. */
const calibratedMiddle = 0.551;

/** The material's color applied to `${p}refracted`, written to `${p}color`.
 *
 * As on macOS, brightness is shaped on luminance and applied to each pixel as
 * one multiplier, so the glass keeps the hue and colorfulness of what is
 * behind it; only the lift of the blacks is added evenly. Shaping each channel
 * on its own would flatten bright colors toward gray. The curve runs through
 * the calibrated black, middle and white outputs: `black + L * h(L)`. */
export function toneMarkup(
  p: string,
  o: MaterialOptions,
  size: number,
  input = `${p}refracted`,
): string {
  const { saturation, tone } = glassRecipe(o, size);
  const [black, middle, white] = tone;
  // A lens passes its pixels unchanged: no passes, only the name.
  if (saturation === 1 && black === 0 && white === 1 && Math.abs(middle - calibratedMiddle) < 1e-3)
    return `<feOffset in="${input}" result="${p}color"/>`;
  // The quadratic through the three calibrated points, held level wherever it
  // would fall, so a brighter backdrop never turns darker glass.
  const m = calibratedMiddle;
  const c = (middle - black - (white - black) * m) / (m * m - m);
  const b = white - black - c;
  let level = 0;
  const curve = Array.from({ length: 33 }, (_, n) => {
    const v = n / 32;
    level = Math.max(level, Math.min(1, black + b * v + c * v * v));
    return level;
  });
  // The multiplier each luminance takes; every calibration keeps it within a
  // channel's range. At black it is the curve's slope there.
  const gain = curve
    .map((value, n) => {
      const v = n / 32;
      const h = v === 0 ? b : (value - black) / v;
      return Math.max(0, Math.min(1, h));
    })
    .join(" ");
  const luminance = "0.2126 0.7152 0.0722 0 0";
  // A straight curve (Clear: black + 0.955 x) scales every pixel alike, so
  // one linear pass per channel gives the same result as shaping luminance.
  if (Math.abs(c) < 1e-3) {
    const linear = (["R", "G", "B"] as const)
      .map((ch) => `<feFunc${ch} type="linear" slope="${b}" intercept="${black}"/>`)
      .join("");
    return (
      (saturation === 1
        ? ""
        : `<feColorMatrix in="${input}" type="saturate" values="${saturation}" result="${p}saturated"/>`) +
      `<feComponentTransfer in="${saturation === 1 ? input : `${p}saturated`}" result="${p}color">${linear}</feComponentTransfer>`
    );
  }
  // Without a saturation change the input is used as it is.
  const saturated = saturation === 1 ? input : `${p}saturated`;
  return (
    (saturation === 1
      ? ""
      : `<feColorMatrix in="${input}" type="saturate" values="${saturation}" result="${p}saturated"/>`) +
    `<feColorMatrix in="${saturated}" type="matrix" values="${luminance} ${luminance} ${luminance} 0 0 0 0 1" result="${p}luminance"/>` +
    `<feComponentTransfer in="${p}luminance" result="${p}gain"><feFuncR type="table" tableValues="${gain}"/><feFuncG type="table" tableValues="${gain}"/><feFuncB type="table" tableValues="${gain}"/></feComponentTransfer>` +
    `<feComposite in="${saturated}" in2="${p}gain" operator="arithmetic" k1="1" k2="0" k3="0" k4="0" result="${p}scaled"/>` +
    `<feComponentTransfer in="${p}scaled" result="${p}color"><feFuncR type="linear" slope="1" intercept="${black}"/><feFuncG type="linear" slope="1" intercept="${black}"/><feFuncB type="linear" slope="1" intercept="${black}"/></feComponentTransfer>`
  );
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
export function tintMarkup(
  p: string,
  o: MaterialOptions,
  tint: number[],
): { markup: string; color: string } {
  const body = o.material === "regular" ? 0.78 : 0.68;
  const channels = ["R", "G", "B"];
  return {
    markup:
      `<feColorMatrix in="${p}color" type="saturate" values="0" result="${p}tintLuminance"/>` +
      `<feComponentTransfer in="${p}tintLuminance" result="${p}tinted">${channels.map((channel, index) => `<feFunc${channel} type="linear" slope="${tint[index] * (1 - body)}" intercept="${tint[index] * body}"/>`).join("")}<feFuncA type="linear" slope="${1 - body}" intercept="${body}"/></feComponentTransfer>`,
    color: `${p}tinted`,
  };
}

/** The outline just outside glass, as macOS draws it: what is behind the
 * glass (`backdrop`) darkens where the rim map (`rim`) has coverage, by black
 * at `rim × (base + slope × x)` for a backdrop of brightness x (see
 * `outlineFor`), returned as `${p}outline`. */
export function outlineMarkup(
  p: string,
  backdrop: string,
  rim: string,
  opacity = 1,
  shape: { base: number; slope: number } = { base: 1.5, slope: -1 },
): string {
  const luminance = "0.2126 0.7152 0.0722 0 0";
  return (
    `<feColorMatrix in="${backdrop}" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ${luminance}" result="${p}lum"/>` +
    `<feComposite in="${rim}" in2="${p}lum" operator="arithmetic" k1="${shape.slope * opacity}" k2="${shape.base * opacity}" k3="0" k4="0" result="${p}outline"/>`
  );
}

/** Add the rim's key and fill light (`light`, white light as coverage) to the
 * glass's color `color`, then keep it to the coverage `mask`, as macOS lights
 * its glass: the light adds to the face rather than covering it. Masking once,
 * after the light, keeps a partly covered edge pixel's coverage exact, so the
 * page behind never shows through the rim. Regular glass adds the same light
 * over any face; Clear adds more over a brighter one, as its light scales what
 * is behind it (measured: its light over mid gray is 1.7 times its light over
 * black). */
export function lightMarkup(
  p: string,
  color: string,
  light: string,
  mask: string,
  material: MaterialOptions["material"] = "regular",
): string {
  const scaled = material !== "regular";
  return (
    `<feComposite in="${color}" in2="${light}" operator="arithmetic" k1="${scaled ? 1.445 : 0}" k2="1" k3="${scaled ? 0.82 : 1}" k4="0" result="${p}lit"/>` +
    `<feComposite in="${p}lit" in2="${mask}" operator="in" result="${p}litInside"/>`
  );
}

/** The rim's key light is white. Scaling its color recolors the light alone
 * and keeps the coverage the WGSL renderer computed. */
export function overlayTintMarkup(input: string, result: string, tint: number[]): string {
  return `<feComponentTransfer in="${input}" result="${result}">${["R", "G", "B"].map((channel, index) => `<feFunc${channel} type="linear" slope="${0.45 + 0.55 * tint[index]}"/>`).join("")}</feComponentTransfer>`;
}

/** Regular glass's shadow, from its coverage `mask` over `box`: the coverage
 * blurred, moved down and kept outside the shape, as black at the shadow's
 * opacity. Every primitive names its own region, which reaches past the glass. */
export function glassShadowMarkup(
  p: string,
  mask: string,
  box: { x: number; y: number; width: number; height: number },
  opacity: number,
  shadow: GlassShadow,
): { markup: string; result: string } {
  const r = shadowReach(shadow);
  const area = `x="${box.x - r}" y="${box.y - r}" width="${box.width + 2 * r}" height="${box.height + 2 * r}"`;
  const alpha = shadow.opacity * opacity;
  return {
    markup:
      `<feGaussianBlur in="${mask}" stdDeviation="${shadow.blur}" ${area} result="${p}shadowBlur"/>` +
      `<feOffset in="${p}shadowBlur" dy="${shadow.dy}" ${area} result="${p}shadowOffset"/>` +
      `<feComposite in="${p}shadowOffset" in2="${mask}" operator="out" ${area} result="${p}shadowOut"/>` +
      `<feColorMatrix in="${p}shadowOut" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ${alpha} 0" ${area} result="${p}shadow"/>`,
    result: `${p}shadow`,
  };
}
