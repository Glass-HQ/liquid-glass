/**
 * Text: where each line of a text node sits (from `Range.getClientRects()`), which characters are
 * on it, and the line drawn into its own bitmap with the canvas text engine.
 *
 * Whole line runs are drawn rather than glyphs, so shaping, ligatures, kerning, bidi reordering
 * and color emoji come from the same engine that laid the page out. A text node's lines are
 * found from its client rects; the character offset where each needed line starts is found with
 * a galloping binary search over the node's non-space characters, one single-character range per
 * probe. Only lines inside the capture window are split and drawn.
 */

import { parseColor } from "../core/color";
import type { Rect } from "../protocol";
import { px, textShadowsOf } from "./css";
import type { Decoration, RunMeta } from "./types";
import { snapshot } from "./snapshot";

export interface TextStyle {
  /** Canvas font shorthand at CSS size. */
  readonly font: string;
  readonly size: number;
  readonly color: string;
  readonly direction: CanvasDirection;
  readonly letterSpacing: number;
  readonly wordSpacing: number;
  readonly justify: boolean;
  readonly align: string;
  readonly whiteSpace: string;
  readonly transform: string;
  readonly stretch: string;
  readonly caps: string;
  readonly kerning: string;
  readonly shadows: readonly [number, number, number, string][];
  readonly decorations: readonly Decoration[];
  readonly tabSize: number;
  /** Everything above in one string, for cache keys. */
  readonly key: string;
}

const STRETCH: Record<string, string> = {
  "50%": "ultra-condensed",
  "62.5%": "extra-condensed",
  "75%": "condensed",
  "87.5%": "semi-condensed",
  "100%": "normal",
  "112.5%": "semi-expanded",
  "125%": "expanded",
  "150%": "extra-expanded",
  "200%": "ultra-expanded",
};

/** The text style of an element's own text, or null when its text paints nothing. */
export function textStyleOf(
  style: CSSStyleDeclaration,
  decorations: readonly Decoration[],
): TextStyle | null {
  const fill = style.webkitTextFillColor || style.color;
  const parsed = parseColor(fill);
  if (!parsed || parsed[3] <= 0) return null;
  const size = px(style.fontSize);
  if (!(size > 0)) return null;
  const fontStyle = style.fontStyle.startsWith("oblique") ? "oblique" : style.fontStyle;
  const caps = style.fontVariantCaps || "normal";
  const stretch =
    STRETCH[style.fontStretch] ??
    (style.fontStretch.endsWith("%") ? "normal" : style.fontStretch || "normal");
  const weight = style.fontWeight;
  const capsWord = caps === "small-caps" ? "small-caps " : "";
  const font = `${fontStyle} ${capsWord}${weight} ${size}px ${style.fontFamily}`;
  const letterSpacing = style.letterSpacing === "normal" ? 0 : px(style.letterSpacing);
  const wordSpacing = style.wordSpacing === "normal" ? 0 : px(style.wordSpacing);
  const align = style.textAlign;
  const justify = align === "justify";
  const whiteSpace = style.whiteSpace;
  const transform = style.textTransform;
  const direction: CanvasDirection = style.direction === "rtl" ? "rtl" : "ltr";
  const kerning = style.fontKerning || "auto";
  const shadows = textShadowsOf(style.textShadow);
  const tabSize = Number.parseFloat(style.tabSize) || 8;
  const decorationKey = decorations
    .map(
      (d) =>
        `${d.underline ? "u" : ""}${d.overline ? "o" : ""}${d.lineThrough ? "s" : ""}${d.color}/${d.thickness}/${d.offset}`,
    )
    .join(";");
  const key = [
    font,
    fill,
    direction,
    letterSpacing,
    wordSpacing,
    stretch,
    caps,
    kerning,
    shadows.map((s) => s.join(" ")).join(","),
    decorationKey,
  ].join("|");
  return {
    font,
    size,
    color: fill,
    direction,
    letterSpacing,
    wordSpacing,
    justify,
    align,
    whiteSpace,
    transform,
    stretch,
    caps,
    kerning,
    shadows,
    decorations,
    tabSize,
    key,
  };
}

// ---------------------------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------------------------

let measureContext: OffscreenCanvasRenderingContext2D | null = null;
let measureFont = "";

function measurer(): OffscreenCanvasRenderingContext2D | null {
  if (!measureContext) measureContext = new OffscreenCanvas(1, 1).getContext("2d");
  return measureContext;
}

function useFont(context: OffscreenCanvasRenderingContext2D, style: TextStyle): void {
  context.font = style.font;
  // Optional canvas text properties: assigning an unsupported one is a harmless no-op.
  context.fontKerning =
    style.kerning === "none" ? "none" : style.kerning === "normal" ? "normal" : "auto";
  if (style.stretch !== "normal") context.fontStretch = style.stretch as CanvasFontStretch;
  if (style.caps !== "normal" && style.caps !== "small-caps")
    context.fontVariantCaps = style.caps as CanvasFontVariantCaps;
  context.letterSpacing = `${style.letterSpacing}px`;
  context.wordSpacing = `${style.wordSpacing}px`;
}

const supportsSpacing = (): boolean => {
  const context = measurer();
  return !!context && "letterSpacing" in context && "wordSpacing" in context;
};
let spacingSupported: boolean | null = null;
const spacing = (): boolean => (spacingSupported ??= supportsSpacing());

export interface FontMetrics {
  readonly ascent: number;
  readonly descent: number;
  readonly xHeight: number;
}

const metricsCache = new Map<string, FontMetrics>();

export function metricsOf(style: TextStyle): FontMetrics {
  const cached = metricsCache.get(style.font);
  if (cached) return cached;
  const context = measurer();
  let metrics: FontMetrics = {
    ascent: style.size * 0.8,
    descent: style.size * 0.2,
    xHeight: style.size * 0.5,
  };
  if (context) {
    context.font = style.font;
    measureFont = "";
    const m = context.measureText("Hxg");
    const x = context.measureText("x");
    const ascent = m.fontBoundingBoxAscent;
    const descent = m.fontBoundingBoxDescent;
    metrics = {
      ascent:
        Number.isFinite(ascent) && ascent > 0
          ? ascent
          : m.actualBoundingBoxAscent || style.size * 0.8,
      descent:
        Number.isFinite(descent) && descent >= 0
          ? descent
          : m.actualBoundingBoxDescent || style.size * 0.2,
      xHeight: x.actualBoundingBoxAscent || style.size * 0.5,
    };
  }
  if (metricsCache.size > 512) metricsCache.clear();
  metricsCache.set(style.font, metrics);
  return metrics;
}

/** Width of a string in CSS px at the style's size, letter spacing included. */
export function measure(text: string, style: TextStyle): number {
  const context = measurer();
  if (!context) return text.length * style.size * 0.5;
  if (measureFont !== style.key) {
    useFont(context, style);
    measureFont = style.key;
  }
  const width = context.measureText(text).width;
  return spacing() ? width : width + style.letterSpacing * [...text].length;
}

/** Forget measurements after fonts load. */
export function resetMetrics(): void {
  metricsCache.clear();
  measureFont = "";
}

// ---------------------------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------------------------

/** A line box of a text node, in viewport coordinates now. */
export interface Line {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Group a text node's client rects into lines (several rects per line for bidi runs). */
export function linesOf(rects: DOMRectList): Line[] {
  const lines: Line[] = [];
  let current: Line | null = null;
  for (let index = 0; index < rects.length; index += 1) {
    const r = rects[index];
    if (!r || r.width <= 0 || r.height <= 0) continue;
    if (current) {
      const overlap = Math.min(current.bottom, r.bottom) - Math.max(current.top, r.top);
      if (overlap > Math.min(current.bottom - current.top, r.height) * 0.5) {
        current.left = Math.min(current.left, r.left);
        current.right = Math.max(current.right, r.right);
        current.top = Math.min(current.top, r.top);
        current.bottom = Math.max(current.bottom, r.bottom);
        continue;
      }
    }
    current = { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    lines.push(current);
  }
  return lines;
}

const SPACE = /\s/;
const NON_SPACE = /\S/gu;

/**
 * Character offsets where lines start, for the lines in `needed` (and the line after each, so
 * every needed line has an end). Index i of the result is the start of line i, or -1 if it was
 * not computed. Index lines.length is the text's end.
 */
export function lineStarts(
  range: Range,
  node: Text,
  lines: readonly Line[],
  needed: readonly number[],
  whiteSpace: string,
): number[] {
  const data = node.data;
  const count = lines.length;
  const starts = new Array<number>(count + 1).fill(-1);
  starts[0] = 0;
  starts[count] = data.length;
  if (count <= 1) return starts;

  // Preformatted text without wrapping breaks only at newlines: map them to lines directly.
  const preformatted = whiteSpace === "pre" ? mapPreformatted(data, lines.length) : null;
  if (preformatted) return preformatted;

  const stops: number[] = [];
  for (const match of data.matchAll(NON_SPACE)) stops.push(match.index);
  const n = stops.length;
  const memo = new Map<number, number>();
  const lineAt = (y: number): number => {
    let lo = 0;
    let hi = count - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((lines[mid]?.top ?? 0) <= y) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const lineOf = (j: number): number => {
    const known = memo.get(j);
    if (known !== undefined) return known;
    const offset = stops[j] ?? data.length;
    const code = data.codePointAt(offset) ?? 0;
    range.setStart(node, offset);
    range.setEnd(node, Math.min(data.length, offset + (code > 0xffff ? 2 : 1)));
    const rects = range.getClientRects();
    let line = -1;
    for (let index = 0; index < rects.length; index += 1) {
      const r = rects[index];
      if (r && r.height > 0) {
        line = lineAt((r.top + r.bottom) / 2);
        break;
      }
    }
    memo.set(j, line);
    return line;
  };
  // Smallest j >= lo whose line is >= k, galloping out from a guess.
  const firstOnOrAfter = (k: number, from: number, guess: number): number => {
    let lo = from;
    let hi = n;
    if (lo >= n) return n;
    let probe = Math.min(n - 1, Math.max(lo, guess));
    if (lineOf(probe) >= k) {
      hi = probe;
      for (let step = 1; ; step *= 2) {
        const next = probe - step;
        if (next < lo) break;
        if (lineOf(next) < k) {
          lo = next + 1;
          break;
        }
        hi = next;
        probe = next;
      }
    } else {
      lo = probe + 1;
      for (let step = 1; ; step *= 2) {
        const next = probe + step;
        if (next >= n) break;
        if (lineOf(next) >= k) {
          hi = next;
          break;
        }
        lo = next + 1;
        probe = next;
      }
    }
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (lineOf(mid) >= k) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  };

  const average = n / count;
  const wanted = new Set<number>();
  for (const k of needed) {
    if (k > 0) wanted.add(k);
    if (k + 1 < count) wanted.add(k + 1);
  }
  const ordered = [...wanted].sort((a, b) => a - b);
  let from = 0;
  let previousLine = 0;
  for (const k of ordered) {
    const guess = from + Math.round(average * (k - previousLine));
    const j = firstOnOrAfter(k, from, guess);
    starts[k] = j < n ? (stops[j] ?? data.length) : data.length;
    from = j;
    previousLine = k;
  }
  return starts;
}

/** Lines of `white-space: pre` text never wrap, so they start after newlines. */
function mapPreformatted(data: string, count: number): number[] | null {
  if (!data.includes("\n")) return null;
  const starts: number[] = [];
  let at = 0;
  for (const segment of data.split("\n")) {
    if (segment.length > 0) starts.push(at);
    at += segment.length + 1;
  }
  if (starts.length !== count) return null;
  starts.push(data.length);
  return starts;
}

/** Whether the whitespace at `offset` takes up room on its line (it was not collapsed away). */
export function spaceRendered(range: Range, node: Text, offset: number): boolean {
  range.setStart(node, offset);
  range.setEnd(node, offset + 1);
  const rects = range.getClientRects();
  for (let index = 0; index < rects.length; index += 1)
    if ((rects[index]?.width ?? 0) > 0.5) return true;
  return false;
}

const COLLAPSIBLE = /[\t\n\r\f ]+/g;

/** The characters of one line as drawn: whitespace processed and text-transform applied. */
export function lineText(
  raw: string,
  style: TextStyle,
  keepLeadingSpace: boolean,
  lastLine: boolean,
): string {
  let text = raw;
  const ws = style.whiteSpace;
  const preserve = ws === "pre" || ws === "pre-wrap" || ws === "break-spaces";
  if (preserve) {
    text = text.replace(/\r?\n/g, "");
    if (text.includes("\t")) text = expandTabs(text, style.tabSize);
  } else {
    text = text.replace(COLLAPSIBLE, " ");
    if (!keepLeadingSpace && text.startsWith(" ")) text = text.slice(1);
  }
  text = text.replace(/\s+$/u, "");
  if (text.includes("­")) {
    const hyphenated = !lastLine && text.endsWith("­");
    text = text.replaceAll("­", "") + (hyphenated ? "-" : "");
  }
  return transformText(text, style.transform);
}

function expandTabs(text: string, tabSize: number): string {
  let out = "";
  let column = 0;
  for (const char of text) {
    if (char === "\t") {
      const pad = tabSize - (column % tabSize);
      out += " ".repeat(pad);
      column += pad;
    } else {
      out += char;
      column += 1;
    }
  }
  return out;
}

/** Cut text to fit `width` CSS px with a trailing ellipsis. */
export function truncate(text: string, style: TextStyle, width: number): string {
  if (measure(text, style) <= width + 0.5) return text;
  const points = [...text];
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (measure(`${points.slice(0, mid).join("")}…`, style) <= width + 0.5) lo = mid;
    else hi = mid - 1;
  }
  // Like the browser, a space before the cut stays.
  return `${points.slice(0, lo).join("")}…`;
}

export const hasVisibleText = (data: string): boolean => {
  for (let index = 0; index < data.length; index += 1)
    if (!SPACE.test(data[index] ?? "")) return true;
  return false;
};

// ---------------------------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------------------------

export interface Run {
  readonly text: string;
  readonly style: TextStyle;
  /** The line box on screen: CSS px, after transforms. */
  readonly box: Rect;
  /** The scale transforms apply to the text (1 for none). */
  readonly zoom: number;
  readonly dpr: number;
  /** Stretch spaces so the run fills the box (justified text). */
  readonly fill: boolean;
}

/** Bitmap pixels per layout px: the device ratio times the transform scale, in steps. */
export function rasterScale(zoom: number, dpr: number): number {
  const steps =
    Math.abs(zoom - 1) < 0.01 ? 1 : Math.min(4, Math.max(0.125, Math.round(zoom * 8) / 8));
  return dpr * steps;
}

/** Sub-pixel phase of the run's left edge in device pixels, in quarter steps. */
const phaseOf = (x: number, dpr: number): number => {
  const device = x * dpr;
  return Math.round((device - Math.floor(device)) * 4) / 4;
};

export function runKey(run: Run): string {
  const scale = rasterScale(run.zoom, run.dpr);
  const width = Math.round((run.box.width / run.zoom) * 4);
  const height = Math.round((run.box.height / run.zoom) * 4);
  const phase = Math.abs(run.zoom - 1) < 0.01 ? phaseOf(run.box.x, run.dpr) : 0;
  return `t|${run.text}|${run.style.key}|${scale}|${width}x${height}|${phase}|${run.fill ? 1 : 0}`;
}

let drawCanvas: OffscreenCanvas | null = null;
let drawContext: OffscreenCanvasRenderingContext2D | null = null;
/** Bitmaps wider or taller than this are scaled down. */
const MAX_SIDE = 8192;

/** Draw one run into a bitmap. */
export function drawRun(run: Run): { image: ImageBitmap; meta: RunMeta } | null {
  const { style, zoom } = run;
  let scale = rasterScale(zoom, run.dpr);
  const width = run.box.width / zoom;
  const height = run.box.height / zoom;
  const metrics = metricsOf(style);
  const ascent = height * (metrics.ascent / (metrics.ascent + metrics.descent || 1));
  let shadowLeft = 0;
  let shadowRight = 0;
  let shadowTop = 0;
  let shadowBottom = 0;
  for (const [sx, sy, blur] of style.shadows) {
    shadowLeft = Math.max(shadowLeft, blur - sx);
    shadowRight = Math.max(shadowRight, blur + sx);
    shadowTop = Math.max(shadowTop, blur - sy);
    shadowBottom = Math.max(shadowBottom, blur + sy);
  }
  const padX = style.size * 0.35;
  const padTop = style.size * 0.3 + shadowTop;
  const padBottom = style.size * 0.4 + shadowBottom;
  if ((width + padX * 2 + shadowLeft + shadowRight) * scale > MAX_SIDE) {
    scale = MAX_SIDE / (width + padX * 2 + shadowLeft + shadowRight);
  }
  const left = Math.ceil((padX + shadowLeft) * scale);
  const top = Math.ceil(padTop * scale);
  const phase = Math.abs(zoom - 1) < 0.01 ? phaseOf(run.box.x, run.dpr) : 0;
  const pixelWidth = Math.max(
    1,
    left + Math.ceil(width * scale + phase) + Math.ceil((padX + shadowRight) * scale),
  );
  const baseline = top + Math.round(ascent * scale);
  const pixelHeight = Math.max(1, baseline + Math.ceil((height - ascent + padBottom) * scale));
  if (pixelHeight > MAX_SIDE) return null;

  if (!drawCanvas) {
    drawCanvas = new OffscreenCanvas(pixelWidth, pixelHeight);
    drawContext = drawCanvas.getContext("2d");
  } else {
    drawCanvas.width = pixelWidth;
    drawCanvas.height = pixelHeight;
  }
  const context = drawContext;
  if (!drawCanvas || !context) return null;
  context.setTransform(scale, 0, 0, scale, 0, 0);
  useFont(context, style);
  context.textBaseline = "alphabetic";
  context.direction = style.direction;
  context.textAlign = "start";
  context.fillStyle = style.color;

  const originX = (left + phase) / scale;
  const baselineY = baseline / scale;
  const rtl = style.direction === "rtl";
  const x = rtl ? originX + width : originX;

  // Justified lines: spread the difference over the spaces, as the layout did.
  let text = run.text;
  let wordGap = 0;
  if (run.fill && text.includes(" ")) {
    const natural = measure(text, style);
    const spaces = text.split(" ").length - 1;
    if (width - natural > 0.5 && spaces > 0) wordGap = (width - natural) / spaces;
  }
  const paint = (dx: number) => {
    if (wordGap > 0 && !spacing()) {
      drawWords(context, text, style, x + dx, baselineY, wordGap, rtl);
      return;
    }
    if (wordGap > 0) context.wordSpacing = `${style.wordSpacing + wordGap}px`;
    if (style.letterSpacing !== 0 && !spacing() && !rtl) {
      drawSpaced(context, text, style, x + dx, baselineY);
      return;
    }
    context.fillText(text, x + dx, baselineY);
  };

  if (style.shadows.length) {
    // Shadows without the text: draw far away and offset the shadow back into view, so a
    // translucent text color is not painted several times over itself.
    const away = 4096;
    for (let index = style.shadows.length - 1; index >= 0; index -= 1) {
      const shadow = style.shadows[index];
      if (!shadow) continue;
      context.shadowColor = shadow[3];
      context.shadowBlur = shadow[2] * scale;
      context.shadowOffsetX = (shadow[0] + away) * scale;
      context.shadowOffsetY = shadow[1] * scale;
      paint(-away);
    }
    context.shadowColor = "transparent";
    context.shadowBlur = 0;
    context.shadowOffsetX = 0;
    context.shadowOffsetY = 0;
  }
  paint(0);
  text = "";

  for (const decoration of style.decorations) {
    context.fillStyle = decoration.color;
    const thickness =
      decoration.thickness > 0 ? decoration.thickness : Math.max(1 / scale, style.size / 14);
    const lineLeft = originX;
    if (decoration.underline) {
      const y = baselineY + Math.max(1 / scale, style.size * 0.09) + decoration.offset;
      context.fillRect(lineLeft, snap(y, scale), width, snapSize(thickness, scale));
    }
    if (decoration.overline)
      context.fillRect(
        lineLeft,
        snap(baselineY - metrics.ascent, scale),
        width,
        snapSize(thickness, scale),
      );
    if (decoration.lineThrough) {
      context.fillRect(
        lineLeft,
        snap(baselineY - metrics.xHeight / 2 - thickness / 2, scale),
        width,
        snapSize(thickness, scale),
      );
    }
  }

  const image = snapshot(drawCanvas);
  return { image, meta: { left: originX, baseline, ascent, scale } };
}

const snap = (value: number, scale: number) => Math.round(value * scale) / scale;
const snapSize = (value: number, scale: number) => Math.max(1, Math.round(value * scale)) / scale;

function drawWords(
  context: OffscreenCanvasRenderingContext2D,
  text: string,
  style: TextStyle,
  x: number,
  y: number,
  gap: number,
  rtl: boolean,
): void {
  const words = text.split(" ");
  const space = measure(" ", style) + gap;
  let cursor = x;
  for (const word of words) {
    if (word) context.fillText(word, cursor, y);
    const advance = measure(word, style) + space;
    cursor += rtl ? -advance : advance;
  }
}

const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

function drawSpaced(
  context: OffscreenCanvasRenderingContext2D,
  text: string,
  style: TextStyle,
  x: number,
  y: number,
): void {
  const graphemes = segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : [...text];
  let cursor = x;
  for (const grapheme of graphemes) {
    context.fillText(grapheme, cursor, y);
    cursor += measure(grapheme, style);
  }
}

/** Where a run's bitmap goes on screen, from its line box and the bitmap's metadata. */
export function runRect(
  box: Rect,
  zoom: number,
  dpr: number,
  meta: RunMeta,
  image: { width: number; height: number },
): Rect {
  const factor = zoom / meta.scale;
  let x = box.x - meta.left * zoom;
  let y = box.y + meta.ascent * zoom - meta.baseline * factor;
  if (Math.abs(zoom - 1) < 0.01) {
    // Land the bitmap on whole device pixels so the worker samples it 1:1.
    x = Math.round(x * dpr) / dpr;
    y = Math.round((box.y + meta.ascent) * dpr) / dpr - meta.baseline / meta.scale;
  }
  return { x, y, width: image.width * factor, height: image.height * factor };
}

/** Apply `text-transform` to text that is not split into lines (form values). */
export function transformText(text: string, transform: string): string {
  switch (transform) {
    case "uppercase":
      return text.toUpperCase();
    case "lowercase":
      return text.toLowerCase();
    case "capitalize":
      return text.replace(
        /(^|[\s\p{P}])(\p{Ll})/gu,
        (_, before: string, letter: string) => before + letter.toUpperCase(),
      );
    default:
      return text;
  }
}
