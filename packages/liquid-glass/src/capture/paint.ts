/**
 * CSS background images (gradients and `url()` images) rasterised on the page into one bitmap
 * per element, at the element's border-box size and device resolution.
 *
 * Every layer honours background-size, -position, -repeat, -origin and -clip (except `text`).
 * Gradients are linear, radial and conic, repeating or not, with stops interpolated the way CSS
 * does it (premultiplied, in sRGB or in Oklab when the gradient asks for it). The canvas cannot
 * interpolate like that, so each segment is subdivided into short canvas stops.
 */

import { cssRgba, parseColor } from "../core/color";
import type { Rgba } from "../protocol";
import { lengthOf, px, splitTop } from "./css";
import { loadImage } from "./media";
import { snapshot } from "./snapshot";

export interface Background {
  readonly key: string;
  draw(): ImageBitmap | null;
}

interface Layer {
  readonly text: string;
  readonly url: string | null;
  readonly image: HTMLImageElement | null;
  readonly size: string;
  readonly x: string;
  readonly y: string;
  readonly repeat: string;
  readonly origin: string;
  readonly clip: string;
}

const URL_PATTERN = /^url\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^)]*))\s*\)$/;
const GRADIENT = /^(repeating-)?(linear|radial|conic)-gradient\(/;
/** Pixels in one background bitmap at most. */
const MAX_PIXELS = 4 * 1024 * 1024;

const at = (list: string[], index: number): string =>
  list[index] ?? list[index % Math.max(1, list.length)] ?? "";

/**
 * Plan an element's background images. Returns null when nothing can be drawn yet (images still
 * loading: `onLoad` is called with the element when they arrive).
 */
export function backgroundOf(
  element: Element,
  style: CSSStyleDeclaration,
  value: string,
  width: number,
  height: number,
  borders: readonly [number, number, number, number],
  zoom: number,
  dpr: number,
  onLoad: (element: Element) => void,
): Background | null {
  const texts = splitTop(value, ",");
  if (!texts.length || !(width > 0 && height > 0)) return null;
  const sizes = splitTop(style.backgroundSize, ",");
  const xs = splitTop(style.backgroundPositionX, ",");
  const ys = splitTop(style.backgroundPositionY, ",");
  const repeats = splitTop(style.backgroundRepeat, ",");
  const origins = splitTop(style.backgroundOrigin, ",");
  const clips = splitTop(style.backgroundClip, ",");
  const layers: Layer[] = [];
  let urls = "";
  for (let index = 0; index < texts.length; index += 1) {
    const text = texts[index] ?? "none";
    const clip = at(clips, index) || "border-box";
    if (text === "none" || clip === "text") continue;
    let url: string | null = null;
    let image: HTMLImageElement | null = null;
    const match = URL_PATTERN.exec(text);
    if (match) {
      url = (match[1] ?? match[2] ?? match[3] ?? "").replace(/\\(.)/g, "$1").trim();
      if (!url) continue;
      image = loadImage(url, element, onLoad);
      if (!image) continue;
      urls += `${image.naturalWidth}x${image.naturalHeight};`;
    } else if (!GRADIENT.test(text)) {
      continue;
    }
    layers.push({
      text,
      url,
      image,
      size: at(sizes, index) || "auto",
      x: at(xs, index) || "0%",
      y: at(ys, index) || "0%",
      repeat: at(repeats, index) || "repeat",
      origin: at(origins, index) || "padding-box",
      clip,
    });
  }
  if (!layers.length) return null;
  // Layout px (before transforms); the bitmap is drawn at device resolution of the screen size.
  const w = width / zoom;
  const h = height / zoom;
  const b = borders.map((v) => v / zoom) as unknown as [number, number, number, number];
  const pad = [
    px(style.paddingTop),
    px(style.paddingRight),
    px(style.paddingBottom),
    px(style.paddingLeft),
  ] as const;
  let scale = dpr * zoom;
  if (w * h * scale * scale > MAX_PIXELS) scale = Math.sqrt(MAX_PIXELS / (w * h));
  scale = Math.min(scale, 4096 / w, 4096 / h);
  const key = [
    "bg",
    value,
    urls,
    style.backgroundSize,
    style.backgroundPositionX,
    style.backgroundPositionY,
    style.backgroundRepeat,
    style.backgroundOrigin,
    style.backgroundClip,
    Math.round(w * 4),
    Math.round(h * 4),
    b.join(","),
    pad.join(","),
    scale.toFixed(3),
  ].join("|");
  const boxOf = (name: string) => {
    if (name === "border-box") return { x: 0, y: 0, width: w, height: h };
    const inset =
      name === "content-box" ? [b[0] + pad[0], b[1] + pad[1], b[2] + pad[2], b[3] + pad[3]] : b;
    return {
      x: inset[3] ?? 0,
      y: inset[0] ?? 0,
      width: Math.max(0, w - (inset[1] ?? 0) - (inset[3] ?? 0)),
      height: Math.max(0, h - (inset[0] ?? 0) - (inset[2] ?? 0)),
    };
  };
  return {
    key,
    draw: () => {
      const canvas = new OffscreenCanvas(
        Math.max(1, Math.ceil(w * scale)),
        Math.max(1, Math.ceil(h * scale)),
      );
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.scale(scale, scale);
      for (let index = layers.length - 1; index >= 0; index -= 1) {
        const layer = layers[index];
        if (layer) drawLayer(context, layer, boxOf(layer.origin), boxOf(layer.clip), scale);
      }
      return snapshot(canvas);
    },
  };
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function along(token: string, free: number): number {
  const parts = token.split(" ");
  if (parts.length === 2) {
    // "right 10px": an offset from the far edge.
    const offset = lengthOf(parts[1] ?? "", free) ?? 0;
    return parts[0] === "right" || parts[0] === "bottom" ? free - offset : offset;
  }
  switch (token) {
    case "left":
    case "top":
      return 0;
    case "right":
    case "bottom":
      return free;
    case "center":
      return free / 2;
  }
  const calc = /^calc\(\s*(-?[\d.]+)%\s*([+-])\s*(-?[\d.]+)px\s*\)$/.exec(token);
  if (calc) return (Number(calc[1]) / 100) * free + (calc[2] === "-" ? -1 : 1) * Number(calc[3]);
  return lengthOf(token, free) ?? 0;
}

function tileSize(
  size: string,
  area: Box,
  natural: { width: number; height: number } | null,
): { width: number; height: number } {
  if (size === "cover" || size === "contain") {
    if (!natural) return { width: area.width, height: area.height };
    const s =
      size === "cover"
        ? Math.max(area.width / natural.width, area.height / natural.height)
        : Math.min(area.width / natural.width, area.height / natural.height);
    return { width: natural.width * s, height: natural.height * s };
  }
  const [a = "auto", b = "auto"] = size.split(" ");
  let width = a === "auto" ? null : lengthOf(a, area.width);
  let height = b === "auto" ? null : lengthOf(b, area.height);
  if (natural) {
    if (width === null && height === null) return { width: natural.width, height: natural.height };
    if (width === null) width = ((height ?? 0) * natural.width) / natural.height;
    if (height === null) height = (width * natural.height) / natural.width;
    return { width, height };
  }
  return { width: width ?? area.width, height: height ?? area.height };
}

function drawLayer(
  context: OffscreenCanvasRenderingContext2D,
  layer: Layer,
  origin: Box,
  clip: Box,
  scale: number,
): void {
  if (clip.width <= 0 || clip.height <= 0) return;
  const natural = layer.image
    ? { width: layer.image.naturalWidth || 1, height: layer.image.naturalHeight || 1 }
    : null;
  const tile = tileSize(layer.size, origin, natural);
  if (!(tile.width > 0 && tile.height > 0)) return;
  const tx = origin.x + along(layer.x, origin.width - tile.width);
  const ty = origin.y + along(layer.y, origin.height - tile.height);
  const [rx, ry] = repeatOf(layer.repeat);
  context.save();
  context.beginPath();
  context.rect(clip.x, clip.y, clip.width, clip.height);
  context.clip();
  if (!rx && !ry) {
    if (layer.image) context.drawImage(layer.image, tx, ty, tile.width, tile.height);
    else {
      context.translate(tx, ty);
      paintGradient(context, layer.text, tile.width, tile.height);
    }
    context.restore();
    return;
  }
  let source: CanvasImageSource | null = layer.image;
  let sourceWidth = natural?.width ?? 1;
  let sourceHeight = natural?.height ?? 1;
  if (!source) {
    sourceWidth = Math.max(1, Math.round(tile.width * scale));
    sourceHeight = Math.max(1, Math.round(tile.height * scale));
    const tileCanvas = new OffscreenCanvas(sourceWidth, sourceHeight);
    const tileContext = tileCanvas.getContext("2d");
    if (!tileContext) {
      context.restore();
      return;
    }
    tileContext.scale(sourceWidth / tile.width, sourceHeight / tile.height);
    paintGradient(tileContext, layer.text, tile.width, tile.height);
    source = tileCanvas;
  }
  const pattern = context.createPattern(source, rx && ry ? "repeat" : rx ? "repeat-x" : "repeat-y");
  if (pattern) {
    pattern.setTransform(
      new DOMMatrix()
        .translateSelf(tx, ty)
        .scaleSelf(tile.width / sourceWidth, tile.height / sourceHeight),
    );
    context.fillStyle = pattern;
    context.fillRect(clip.x, clip.y, clip.width, clip.height);
  }
  context.restore();
}

function repeatOf(value: string): [boolean, boolean] {
  switch (value) {
    case "no-repeat":
      return [false, false];
    case "repeat-x":
      return [true, false];
    case "repeat-y":
      return [false, true];
  }
  const [x = "repeat", y = x] = value.split(" ");
  return [x !== "no-repeat", y !== "no-repeat"];
}

// ---------------------------------------------------------------------------------------------
// Gradients
// ---------------------------------------------------------------------------------------------

const PRELUDE_WORDS = new Set([
  "to",
  "at",
  "from",
  "in",
  "circle",
  "ellipse",
  "closest-side",
  "closest-corner",
  "farthest-side",
  "farthest-corner",
]);
const NUMERIC = /^-?[\d.]+(?:e-?\d+)?(deg|rad|grad|turn|px|%)?$/i;

function angleOf(token: string): number | null {
  const match = /^(-?[\d.]+(?:e-?\d+)?)(deg|rad|grad|turn)?$/i.exec(token);
  if (!match) return null;
  const value = Number(match[1]);
  switch ((match[2] ?? "deg").toLowerCase()) {
    case "rad":
      return value;
    case "grad":
      return (value * Math.PI) / 200;
    case "turn":
      return value * Math.PI * 2;
    default:
      return (value * Math.PI) / 180;
  }
}

/** A stop position as a fraction of the gradient length (`length` px) or of a turn. */
function positionOf(token: string, length: number): number | null {
  if (token.endsWith("%")) return Number.parseFloat(token) / 100;
  if (token.endsWith("px")) return length > 0 ? Number.parseFloat(token) / length : 0;
  const angle = angleOf(token);
  if (angle !== null && /[a-z]$/i.test(token)) return angle / (Math.PI * 2);
  const value = Number.parseFloat(token);
  return Number.isFinite(value) && value === 0 ? 0 : null;
}

interface Stop {
  color: Rgba;
  pos: number | null;
}

function parseStops(args: readonly string[], length: number): Stop[] {
  const stops: Stop[] = [];
  for (const arg of args) {
    const tokens = splitTop(arg, " ");
    const positions: string[] = [];
    while (tokens.length > 1 && NUMERIC.test(tokens[tokens.length - 1] ?? ""))
      positions.unshift(tokens.pop() ?? "");
    if (tokens.length === 1 && NUMERIC.test(tokens[0] ?? "")) continue; // an interpolation hint
    const color = parseColor(tokens.join(" "));
    if (!color) continue;
    if (!positions.length) stops.push({ color, pos: null });
    for (const token of positions) stops.push({ color, pos: positionOf(token, length) });
  }
  return stops;
}

/** Fill in missing stop positions and make them non-decreasing, as CSS does. */
function fixStops(stops: Stop[]): { color: Rgba; pos: number }[] {
  if (!stops.length) return [];
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (first && first.pos === null) first.pos = 0;
  if (last && last.pos === null) last.pos = 1;
  let max = Number.NEGATIVE_INFINITY;
  for (const stop of stops) {
    if (stop.pos === null) continue;
    stop.pos = Math.max(stop.pos, max);
    max = stop.pos;
  }
  let previous = 0;
  for (let index = 1; index < stops.length; index += 1) {
    if (stops[index]?.pos !== null) {
      const from = stops[previous]?.pos ?? 0;
      const to = stops[index]?.pos ?? from;
      for (let k = previous + 1; k < index; k += 1) {
        const stop = stops[k];
        if (stop) stop.pos = from + ((to - from) * (k - previous)) / (index - previous);
      }
      previous = index;
    }
  }
  return stops.map((stop) => ({ color: stop.color, pos: stop.pos ?? 0 }));
}

/** Repeat stops so they cover [from, to]. */
function repeatStops(
  stops: { color: Rgba; pos: number }[],
  from: number,
  to: number,
): { color: Rgba; pos: number }[] {
  const first = stops[0]?.pos ?? 0;
  const last = stops[stops.length - 1]?.pos ?? 0;
  const period = last - first;
  if (!(period > 1e-6)) return stops;
  const k0 = Math.floor((from - first) / period);
  const k1 = Math.ceil((to - first) / period);
  const out: { color: Rgba; pos: number }[] = [];
  for (let k = k0; k <= k1 && out.length < 2048; k += 1) {
    for (const stop of stops) out.push({ color: stop.color, pos: stop.pos + k * period });
  }
  return out;
}

// sRGB <-> Oklab, for gradients interpolated `in oklab` / `in oklch`.
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * Math.max(0, c) ** (1 / 2.4) - 0.055;

function toOklab([r, g, b]: Rgba): [number, number, number] {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([L, A, B]: [number, number, number]): [number, number, number] {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

function mix(a: Rgba, b: Rgba, t: number, oklab: boolean): Rgba {
  const alpha = a[3] + (b[3] - a[3]) * t;
  if (alpha <= 0) return [0, 0, 0, 0];
  if (oklab) {
    const la = toOklab(a);
    const lb = toOklab(b);
    const c: [number, number, number] = [0, 1, 2].map(
      (i) => ((la[i] ?? 0) * a[3] + ((lb[i] ?? 0) * b[3] - (la[i] ?? 0) * a[3]) * t) / alpha,
    ) as [number, number, number];
    const [r, g, bl] = fromOklab(c);
    return [r, g, bl, alpha];
  }
  const channel = (i: 0 | 1 | 2) => (a[i] * a[3] + (b[i] * b[3] - a[i] * a[3]) * t) / alpha;
  return [channel(0), channel(1), channel(2), alpha];
}

const SUBDIVISIONS = 8;

const sameColor = (a: Rgba, b: Rgba) =>
  a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];

/** Canvas stops for CSS stops mapped from [from, to] onto [0, 1]. */
function addStops(
  gradient: CanvasGradient,
  stops: readonly { color: Rgba; pos: number }[],
  from: number,
  to: number,
  oklab: boolean,
): void {
  const span = to - from || 1;
  const offset = (pos: number) => Math.min(1, Math.max(0, (pos - from) / span));
  for (let index = 0; index < stops.length; index += 1) {
    const stop = stops[index];
    if (!stop) continue;
    gradient.addColorStop(offset(stop.pos), cssRgba(stop.color));
    const next = stops[index + 1];
    if (!next || next.pos <= stop.pos || sameColor(stop.color, next.color)) continue;
    // Skip subdivision when both ends are clamped outside the visible range.
    if ((stop.pos < from && next.pos < from) || (stop.pos > to && next.pos > to)) continue;
    for (let k = 1; k < SUBDIVISIONS; k += 1) {
      const t = k / SUBDIVISIONS;
      gradient.addColorStop(
        offset(stop.pos + (next.pos - stop.pos) * t),
        cssRgba(mix(stop.color, next.color, t, oklab)),
      );
    }
  }
}

/** Remove `in <color-space> [<hue> hue]` from a prelude and report whether it asks for Oklab. */
function stripInterpolation(tokens: string[]): boolean {
  const index = tokens.indexOf("in");
  if (index < 0) return false;
  const space = tokens[index + 1] ?? "";
  let end = index + 2;
  if (tokens[end + 1] === "hue") end += 2;
  tokens.splice(index, end - index);
  return space === "oklab" || space === "oklch";
}

/** Paint a CSS gradient over (0, 0, width, height) of the context's current space. */
export function paintGradient(
  context: OffscreenCanvasRenderingContext2D,
  text: string,
  width: number,
  height: number,
): void {
  const head = GRADIENT.exec(text);
  if (!head) return;
  const repeating = !!head[1];
  const type = head[2];
  const inner = text.slice(head[0].length, text.lastIndexOf(")"));
  const args = splitTop(inner, ",");
  const firstTokens = splitTop(args[0] ?? "", " ");
  const hasPrelude = PRELUDE_WORDS.has(firstTokens[0] ?? "") || NUMERIC.test(firstTokens[0] ?? "");
  const prelude = hasPrelude ? firstTokens : [];
  const stopArgs = hasPrelude ? args.slice(1) : args;
  const oklab = stripInterpolation(prelude);

  if (type === "linear") {
    let angle = Math.PI;
    if (prelude[0] === "to") {
      const words = new Set(prelude.slice(1));
      const sx = words.has("right") ? 1 : words.has("left") ? -1 : 0;
      const sy = words.has("bottom") ? 1 : words.has("top") ? -1 : 0;
      if (sx && sy) angle = Math.atan2(sx * height, -(sy * width));
      else angle = sx > 0 ? Math.PI / 2 : sx < 0 ? -Math.PI / 2 : sy < 0 ? 0 : Math.PI;
    } else if (prelude[0]) {
      angle = angleOf(prelude[0]) ?? Math.PI;
    }
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    const length = Math.abs(width * sin) + Math.abs(height * cos);
    let stops = fixStops(parseStops(stopArgs, length));
    if (!stops.length) return;
    if (repeating) stops = repeatStops(stops, 0, 1);
    const from = stops[0]?.pos ?? 0;
    let to = stops[stops.length - 1]?.pos ?? 1;
    if (to - from < 1e-6) to = from + 1e-6;
    const cx = width / 2;
    const cy = height / 2;
    const point = (t: number): [number, number] => [
      cx + sin * length * (t - 0.5),
      cy - cos * length * (t - 0.5),
    ];
    const [x0, y0] = point(from);
    const [x1, y1] = point(to);
    const gradient = context.createLinearGradient(x0, y0, x1, y1);
    addStops(gradient, stops, from, to, oklab);
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
    return;
  }

  // Position after "at" (radial and conic).
  const atIndex = prelude.indexOf("at");
  let cx = width / 2;
  let cy = height / 2;
  if (atIndex >= 0) {
    let [px0 = "center", py0 = "center"] = prelude.slice(atIndex + 1);
    if (px0 === "top" || px0 === "bottom" || py0 === "left" || py0 === "right")
      [px0, py0] = [py0, px0];
    cx = along(px0, width);
    cy = along(py0, height);
  }
  const shape = atIndex >= 0 ? prelude.slice(0, atIndex) : prelude;

  if (type === "conic") {
    const fromIndex = shape.indexOf("from");
    const start = fromIndex >= 0 ? (angleOf(shape[fromIndex + 1] ?? "0") ?? 0) : 0;
    let stops = fixStops(parseStops(stopArgs, 1));
    if (!stops.length) return;
    if (repeating) stops = repeatStops(stops, 0, 1);
    const gradient = context.createConicGradient(start - Math.PI / 2, cx, cy);
    addStops(gradient, stops, 0, 1, oklab);
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
    return;
  }

  // Radial: ending shape and size.
  const circle =
    shape.includes("circle") ||
    (!shape.includes("ellipse") && shape.filter((t) => NUMERIC.test(t)).length === 1);
  const lengths = shape.filter((t) => NUMERIC.test(t));
  const keyword =
    shape.find((t) => t.startsWith("closest-") || t.startsWith("farthest-")) ?? "farthest-corner";
  const sideX = [cx, width - cx].map(Math.abs);
  const sideY = [cy, height - cy].map(Math.abs);
  const near = { x: Math.min(...sideX), y: Math.min(...sideY) };
  const far = { x: Math.max(...sideX), y: Math.max(...sideY) };
  let rx: number;
  let ry: number;
  if (lengths.length) {
    rx = lengthOf(lengths[0] ?? "0", width) ?? 0;
    ry = circle ? rx : (lengthOf(lengths[1] ?? lengths[0] ?? "0", height) ?? rx);
  } else {
    const side = keyword.endsWith("side");
    const pick = keyword.startsWith("closest") ? near : far;
    if (circle) {
      rx = ry = side ? Math.min(pick.x, pick.y) : Math.hypot(pick.x, pick.y);
      if (side && keyword.startsWith("farthest")) rx = ry = Math.max(pick.x, pick.y);
    } else if (side) {
      rx = pick.x;
      ry = pick.y;
    } else {
      rx = pick.x * Math.SQRT2;
      ry = pick.y * Math.SQRT2;
    }
  }
  rx = Math.max(rx, 1e-3);
  ry = Math.max(ry, 1e-3);
  let stops = fixStops(parseStops(stopArgs, rx));
  if (!stops.length) return;
  for (const stop of stops) stop.pos = Math.max(0, stop.pos);
  if (repeating) {
    const cover = Math.max(
      ...[0, width].flatMap((x) =>
        [0, height].map((y) => Math.hypot((x - cx) / rx, (y - cy) / ry)),
      ),
    );
    stops = repeatStops(stops, 0, cover);
  }
  const from = stops[0]?.pos ?? 0;
  let to = stops[stops.length - 1]?.pos ?? 1;
  if (to - from < 1e-6) to = from + 1e-6;
  const gradient = context.createRadialGradient(cx, cy, from * rx, cx, cy, to * rx);
  addStops(gradient, stops, from, to, oklab);
  const k = ry / rx;
  context.save();
  context.translate(0, cy);
  context.scale(1, k);
  context.translate(0, -cy);
  context.fillStyle = gradient;
  context.fillRect(0, cy - cy / k, width, height / k);
  context.restore();
}
