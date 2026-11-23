/**
 * Small parsers for computed CSS values. Computed values are already resolved (lengths in px,
 * colors as rgb() or the authored color space), so these only split and convert.
 */

import { parseColor } from "../core/color";
import type { BoxShadow, Radii, Rect } from "../protocol";

export const ZERO_RADII: Radii = [0, 0, 0, 0];

export const px = (value: string): number => {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : 0;
};

/** Split on a separator that is not inside parentheses or quotes. */
export function splitTop(text: string, separator: "," | " " | "/"): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (
      depth === 0 &&
      (separator === " " ? char === " " || char === "\n" || char === "\t" : char === separator)
    ) {
      const part = text.slice(start, index).trim();
      if (part) parts.push(part);
      start = index + 1;
    }
  }
  const last = text.slice(start).trim();
  if (last) parts.push(last);
  return parts;
}

/** A length or percentage against `basis`; `calc()` and other units resolve to null. */
export function lengthOf(token: string, basis: number): number | null {
  const match = /^(-?[\d.]+(?:e-?\d+)?)(px|%)?$/i.exec(token);
  if (!match) return null;
  const value = Number.parseFloat(match[1] ?? "");
  if (!Number.isFinite(value)) return null;
  return match[2] === "%" ? (value / 100) * basis : value;
}

/** One computed corner radius ("8px", "50%", "10px 20px") as horizontal and vertical radii. */
function corner(value: string, width: number, height: number): [number, number] {
  if (value === "0px" || value === "") return [0, 0];
  const [h = "0", v = h] = value.split(" ");
  return [Math.max(0, lengthOf(h, width) ?? px(h)), Math.max(0, lengthOf(v, height) ?? px(v))];
}

/**
 * Per-corner radii of a box, scaled down together when adjacent corners overlap, as CSS does.
 * Elliptical corners become circular with the smaller radius. `width`/`height` are in the same
 * (layout) units as the computed values; the result is multiplied by `zoom`.
 */
export function radiiOf(
  style: CSSStyleDeclaration,
  width: number,
  height: number,
  zoom: number,
): Radii {
  const tl = style.borderTopLeftRadius;
  const tr = style.borderTopRightRadius;
  const br = style.borderBottomRightRadius;
  const bl = style.borderBottomLeftRadius;
  if (tl === "0px" && tr === "0px" && br === "0px" && bl === "0px") return ZERO_RADII;
  const a = corner(tl, width, height);
  const b = corner(tr, width, height);
  const c = corner(br, width, height);
  const d = corner(bl, width, height);
  let f = 1;
  const fit = (sum: number, side: number) => {
    if (sum > side && sum > 0) f = Math.min(f, side / sum);
  };
  fit(a[0] + b[0], width);
  fit(d[0] + c[0], width);
  fit(a[1] + d[1], height);
  fit(b[1] + c[1], height);
  const r = (pair: [number, number]) => Math.min(pair[0], pair[1]) * f * zoom;
  return [r(a), r(b), r(c), r(d)];
}

/** Radii of a box inset by `top/right/bottom/left` (padding box from border box, and so on). */
export function insetRadii(
  radii: Radii,
  top: number,
  right: number,
  bottom: number,
  left: number,
): Radii {
  return [
    Math.max(0, radii[0] - Math.max(top, left)),
    Math.max(0, radii[1] - Math.max(top, right)),
    Math.max(0, radii[2] - Math.max(bottom, right)),
    Math.max(0, radii[3] - Math.max(bottom, left)),
  ];
}

export function insetRect(
  rect: Rect,
  top: number,
  right: number,
  bottom: number,
  left: number,
): Rect {
  return {
    x: rect.x + left,
    y: rect.y + top,
    width: Math.max(0, rect.width - left - right),
    height: Math.max(0, rect.height - top - bottom),
  };
}

const isLength = (token: string) => /^-?[\d.]+(?:e-?\d+)?(px)?$/i.test(token);

/** Outer box shadows; `inset` shadows and invisible ones are dropped. */
export function shadowsOf(value: string, zoom: number): BoxShadow[] {
  if (value === "none" || value === "") return [];
  const shadows: BoxShadow[] = [];
  for (const layer of splitTop(value, ",")) {
    const tokens = splitTop(layer, " ");
    if (tokens.includes("inset")) continue;
    const lengths: number[] = [];
    let colorText = "";
    for (const token of tokens) {
      if (isLength(token)) lengths.push(px(token) * zoom);
      else colorText = colorText ? `${colorText} ${token}` : token;
    }
    const color = parseColor(colorText || "currentcolor");
    if (!color || color[3] <= 0 || lengths.length < 2) continue;
    shadows.push({
      x: lengths[0] ?? 0,
      y: lengths[1] ?? 0,
      blur: Math.max(0, lengths[2] ?? 0),
      spread: lengths[3] ?? 0,
      color,
    });
  }
  return shadows;
}

/** Text shadows for the canvas: [x, y, blur, color], first painted on top. */
export function textShadowsOf(value: string): [number, number, number, string][] {
  if (value === "none" || value === "") return [];
  const out: [number, number, number, string][] = [];
  for (const layer of splitTop(value, ",")) {
    const lengths: number[] = [];
    let color = "";
    for (const token of splitTop(layer, " ")) {
      if (isLength(token)) lengths.push(px(token));
      else color = color ? `${color} ${token}` : token;
    }
    const parsed = parseColor(color || "currentcolor");
    if (!parsed || parsed[3] <= 0) continue;
    out.push([lengths[0] ?? 0, lengths[1] ?? 0, Math.max(0, lengths[2] ?? 0), color]);
  }
  return out.slice(0, 4);
}

const MATRIX = /^matrix\(([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),/;
const MATRIX3D = /^matrix3d\(([^,]+),\s*([^,]+),\s*([^,]+),\s*[^,]+,\s*([^,]+),\s*([^,]+),/;

/**
 * The scale an element applies to its own box and descendants: `transform`, the individual
 * `scale` property and `zoom`. Rotation and skew are ignored; the scale is the length of the
 * transformed x axis, which is right for rotations and close for mild skews.
 */
export function scaleOf(transform: string, scale: string, zoom: string): number {
  let factor = 1;
  if (transform !== "none") {
    const m2 = MATRIX.exec(transform);
    if (m2) factor = Math.hypot(Number(m2[1]), Number(m2[2])) || 1;
    else {
      const m3 = MATRIX3D.exec(transform);
      if (m3) factor = Math.hypot(Number(m3[1]), Number(m3[2])) || 1;
    }
  }
  if (scale !== "none" && scale !== "") {
    const first = Number.parseFloat(scale);
    if (Number.isFinite(first) && first > 0)
      factor *= scale.trim().split(/\s+/)[0]?.endsWith("%") ? first / 100 : first;
  }
  if (zoom && zoom !== "1" && zoom !== "normal") {
    const z = Number.parseFloat(zoom);
    if (Number.isFinite(z) && z > 0) factor *= zoom.endsWith("%") ? z / 100 : z;
  }
  return factor;
}

export const rectEqual = (a: Rect, b: Rect, epsilon = 0.01): boolean =>
  Math.abs(a.x - b.x) < epsilon &&
  Math.abs(a.y - b.y) < epsilon &&
  Math.abs(a.width - b.width) < epsilon &&
  Math.abs(a.height - b.height) < epsilon;

export const intersects = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

export const contains = (outer: Rect, inner: Rect): boolean =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;

export const expand = (r: Rect, dx: number, dy: number): Rect => ({
  x: r.x - dx,
  y: r.y - dy,
  width: r.width + dx * 2,
  height: r.height + dy * 2,
});

export const shift = (r: Rect, dx: number, dy: number): Rect => ({
  x: r.x + dx,
  y: r.y + dy,
  width: r.width,
  height: r.height,
});
