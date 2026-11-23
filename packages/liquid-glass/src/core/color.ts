/**
 * CSS colors as straight (not premultiplied) RGBA in 0..1.
 *
 * Computed styles almost always serialise colors as `rgb()`/`rgba()`, so those, hex and
 * `transparent` are parsed directly. Anything else (named colors, `hsl()`, `oklch()`,
 * `color(display-p3 ...)`, `color-mix()`) goes through a 1×1 canvas, which converts it to sRGB
 * exactly as the browser paints it. Results are cached by the exact string.
 */

import type { Rgba } from "../protocol";

export const TRANSPARENT: Rgba = [0, 0, 0, 0];

const cache = new Map<string, Rgba | null>();
const CACHE_LIMIT = 4096;

const RGB =
  /^rgba?\(\s*([-+\d.e]+%?)[\s,]+([-+\d.e]+%?)[\s,]+([-+\d.e]+%?)(?:\s*[,/]\s*([-+\d.e]+%?))?\s*\)$/i;
const HEX = /^#([\da-f]{3,8})$/i;
const SRGB =
  /^color\(srgb\s+([-+\d.e]+%?)\s+([-+\d.e]+%?)\s+([-+\d.e]+%?)(?:\s*\/\s*([-+\d.e]+%?))?\s*\)$/i;

const clamp01 = (value: number): number => (value <= 0 ? 0 : value >= 1 ? 1 : value);

/** A channel of `rgb()`: 0..255 or a percentage. */
const channel = (text: string): number =>
  text.endsWith("%") ? Number.parseFloat(text) / 100 : Number.parseFloat(text) / 255;

/** An alpha or `color(srgb)` channel: 0..1 or a percentage. */
const unit = (text: string | undefined): number =>
  text === undefined
    ? 1
    : text.endsWith("%")
      ? Number.parseFloat(text) / 100
      : Number.parseFloat(text);

function parseHex(hex: string): Rgba | null {
  if (hex.length !== 3 && hex.length !== 4 && hex.length !== 6 && hex.length !== 8) return null;
  const full = hex.length <= 4 ? [...hex].map((digit) => digit + digit).join("") : hex;
  const byte = (at: number) => Number.parseInt(full.slice(at * 2, at * 2 + 2), 16) / 255;
  return [byte(0), byte(1), byte(2), full.length === 8 ? byte(3) : 1];
}

function finite(color: Rgba): Rgba | null {
  return color.every(Number.isFinite)
    ? [clamp01(color[0]), clamp01(color[1]), clamp01(color[2]), clamp01(color[3])]
    : null;
}

function parseFast(css: string): Rgba | null | undefined {
  if (css === "transparent" || css === "rgba(0, 0, 0, 0)") return TRANSPARENT;
  const rgb = RGB.exec(css);
  if (rgb)
    return finite([
      channel(rgb[1] ?? ""),
      channel(rgb[2] ?? ""),
      channel(rgb[3] ?? ""),
      unit(rgb[4]),
    ]);
  const hex = HEX.exec(css);
  if (hex) return parseHex(hex[1] ?? "");
  const srgb = SRGB.exec(css);
  if (srgb) return finite([unit(srgb[1]), unit(srgb[2]), unit(srgb[3]), unit(srgb[4])]);
  return undefined;
}

let probe: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null | undefined;

function probeContext(): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null {
  if (probe !== undefined) return probe;
  if (typeof OffscreenCanvas !== "undefined") {
    probe = new OffscreenCanvas(1, 1).getContext("2d", { willReadFrequently: true });
  } else if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    probe = canvas.getContext("2d", { willReadFrequently: true });
  } else {
    probe = null;
  }
  return probe;
}

/**
 * Resolve a color through the canvas: an invalid string leaves `fillStyle` unchanged, so it is
 * set twice from two different sentinels to tell "invalid" from "happens to equal the sentinel".
 */
function parseWithCanvas(css: string): Rgba | null {
  const context = probeContext();
  if (!context) return null;
  context.fillStyle = "#000";
  context.fillStyle = css;
  const first = context.fillStyle;
  context.fillStyle = "#fff";
  context.fillStyle = css;
  if (context.fillStyle !== first) return null;
  // The canvas serialises opaque sRGB colors as hex and the rest as rgba(); both parse fast.
  // Wide-gamut colors may serialise as color(...) in some engines: paint and read one pixel.
  const fast = typeof first === "string" ? parseFast(first) : undefined;
  if (fast !== undefined) return fast;
  context.clearRect(0, 0, 1, 1);
  context.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0, a = 0] = context.getImageData(0, 0, 1, 1).data;
  if (a === 0) return TRANSPARENT;
  // getImageData is premultiplied-then-unpremultiplied by the engine; it returns straight bytes.
  return [r / 255, g / 255, b / 255, a / 255];
}

/** Parse any CSS color to straight sRGB RGBA in 0..1, or null if it is not a color. */
export function parseColor(css: string): Rgba | null {
  const text = css.trim();
  const cached = cache.get(text);
  if (cached !== undefined) return cached;
  const fast = parseFast(text);
  const color = fast !== undefined ? fast : parseWithCanvas(text);
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(text, color);
  return color;
}

/** Whether a parsed color paints nothing. */
export const isTransparent = (color: Rgba | null): boolean => color === null || color[3] <= 0;

/** Serialise for a canvas `fillStyle`. */
export function cssRgba(color: Rgba): string {
  const byte = (value: number) => Math.round(clamp01(value) * 255);
  return `rgba(${byte(color[0])}, ${byte(color[1])}, ${byte(color[2])}, ${clamp01(color[3])})`;
}

/**
 * Substitute `var(--name, fallback)` in a CSS value with the custom properties as they compute
 * on `element`, without touching the DOM. A custom property's computed value already has its
 * own `var()`s substituted, so one pass is enough.
 */
export function substituteVariables(value: string, element: Element): string {
  if (!value.includes("var(")) return value;
  const style = getComputedStyle(element);
  let out = "";
  let at = 0;
  while (at < value.length) {
    const start = value.indexOf("var(", at);
    if (start < 0) {
      out += value.slice(at);
      break;
    }
    out += value.slice(at, start);
    // Find the matching parenthesis; a fallback may hold parentheses (and vars) of its own.
    let depth = 0;
    let end = start + 3;
    for (; end < value.length; end += 1) {
      if (value[end] === "(") depth += 1;
      else if (value[end] === ")" && (depth -= 1) === 0) break;
    }
    const inner = value.slice(start + 4, end);
    const comma = inner.indexOf(",");
    const name = (comma < 0 ? inner : inner.slice(0, comma)).trim();
    const own = style.getPropertyValue(name).trim();
    out += own || (comma < 0 ? "" : substituteVariables(inner.slice(comma + 1).trim(), element));
    at = end + 1;
  }
  return out;
}

/** A CSS color as it applies on `element`: `var()`s resolved there, then parsed. */
export function resolveColor(value: string, element: Element): Rgba | null {
  return parseColor(substituteVariables(value, element));
}
