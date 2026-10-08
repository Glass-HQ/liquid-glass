import type { ShapePoint } from "./concentric.js";
import type { GlassRadius } from "./shape.js";
import { smoothUnion } from "./union.js";
import type { RoundRect } from "./union.js";

/** A box in any shared coordinate space. */
export interface Box { left: number; top: number; width: number; height: number }
/** A rounded box: the outline of glass in motion. */
export interface MorphShape extends Box { radius: number }
/** A shape whose maps can be prepared: dimensions, corners, and an optional
 * traced outline in the shape's own box. */
export interface MorphGeometry {
  width: number;
  height: number;
  radius: GlassRadius;
  outline?: ShapePoint[];
  /** Map density. Resting shapes match their surface exactly; shapes passed
   * through in motion use one pixel per CSS pixel. */
  dpr?: number;
  /** A resting shape, whose maps are worth keeping across loads. */
  resting?: boolean;
}

export const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
/** Pixel radius of a declared glass shape at a given size. */
export function radiusPixels(radius: GlassRadius | string | null | undefined, width: number, height: number): number {
  const cap = Math.min(width, height) / 2;
  if (radius === "capsule" || radius === "circle") return cap;
  const value = Number(radius);
  return Math.max(0, Math.min(Number.isFinite(value) ? value : 8, cap));
}
/** How far apart two shapes are: relative size, then corners. */
export function shapeDistance(a: { width: number; height: number; radius: GlassRadius }, b: { width: number; height: number; radius: GlassRadius }): number {
  const ra = radiusPixels(a.radius, a.width, a.height), rb = radiusPixels(b.radius, b.width, b.height);
  return Math.abs(Math.log(a.width / b.width)) + Math.abs(Math.log(a.height / b.height))
    + Math.abs(ra - rb) / Math.max(4, Math.min(b.width, b.height) / 2);
}
/** Gap between two boxes, or zero when they overlap. */
export const boxGap = (a: Box, b: Box) => Math.hypot(
  Math.max(0, a.left - (b.left + b.width), b.left - (a.left + a.width)),
  Math.max(0, a.top - (b.top + b.height), b.top - (a.top + a.height)));
const contains = (outer: Box, inner: Box, tolerance = 0.5) =>
  inner.left >= outer.left - tolerance && inner.top >= outer.top - tolerance &&
  inner.left + inner.width <= outer.left + outer.width + tolerance && inner.top + inner.height <= outer.top + outer.height + tolerance;

/** Where glass grows from and where it grows to. */
export interface MorphEndpoints {
  from: Box;
  fromRadius: GlassRadius;
  to: Box;
  toRadius: GlassRadius;
  /** The axis the surface opens along leads the growth; the other follows.
   * Undefined: both axes move together, as for a layout change. */
  along?: "x" | "y";
}
/** The axis along which `to` lies beyond `from`: the direction a popup opens. */
export function openingAxis(from: Box, to: Box): "x" | "y" {
  const apartY = to.top >= from.top + from.height - 0.5 || to.top + to.height <= from.top + 0.5;
  const apartX = to.left >= from.left + from.width - 0.5 || to.left + to.width <= from.left + 0.5;
  if (apartY !== apartX) return apartY ? "y" : "x";
  const dx = Math.abs(to.left + to.width / 2 - from.left - from.width / 2) / Math.max(1, to.width);
  const dy = Math.abs(to.top + to.height / 2 - from.top - from.height / 2) / Math.max(1, to.height);
  return dx > dy ? "x" : "y";
}
/** Progress of the leading and following axes. Past 1 the spring's overshoot
 * swells the whole shape evenly. */
function axisProgress(p: number, along: boolean, staggered: boolean): number {
  if (!staggered || p >= 1) return p;
  const t = Math.max(0, p);
  return along ? 1 - (1 - t) ** 1.6 : t ** 1.4;
}
/** The outline at progress `p` along the path: it leaves its source with
 * fully rounded, drop-like corners, stretches along the opening axis before
 * it widens, and only takes its final corners once it has nearly arrived. */
export function morphShape(e: MorphEndpoints, p: number): MorphShape {
  const staggered = e.along !== undefined;
  const ax = axisProgress(p, e.along === "x", staggered), ay = axisProgress(p, e.along === "y", staggered);
  const width = Math.max(1, mix(e.from.width, e.to.width, ax));
  const height = Math.max(1, mix(e.from.height, e.to.height, ay));
  const cx = mix(e.from.left + e.from.width / 2, e.to.left + e.to.width / 2, ax);
  const cy = mix(e.from.top + e.from.height / 2, e.to.top + e.to.height / 2, ay);
  const cap = Math.min(width, height) / 2;
  const q = Math.min(1, Math.max(0, p));
  const fromRadius = radiusPixels(e.fromRadius, e.from.width, e.from.height);
  const settled = mix(fromRadius, radiusPixels(e.toRadius, width, height), q);
  // In flight the corners are those of a drop: they grow with the shape
  // instead of settling toward the destination's fixed radius. Continuous
  // corners curve well beyond their radius, so a third of the short side
  // already reads as round.
  const liquid = Math.min(cap, Math.max(settled, 0.34 * Math.min(width, height)));
  // Square-cornered sources round off over the first moments; round ones already are.
  const ramp = 0.12 * (1 - fromRadius / Math.max(1, Math.min(e.from.width, e.from.height) / 2));
  const bulge = staggered ? (ramp > 0 ? smoothstep(0, ramp, q) : 1) * (1 - smoothstep(0.35, 0.8, q)) : 0;
  const radius = Math.min(cap, mix(settled, liquid, bulge));
  return { left: cx - width / 2, top: cy - height / 2, width, height, radius };
}
/** Visibility of a popup's content: it appears once the glass has room. */
export const contentReveal = (p: number) => smoothstep(0.4, 0.9, p);
/** How far the source's own content has withdrawn into the glass that left it. */
export const sourceConceal = (p: number) => smoothstep(0.02, 0.3, p);
/** How far apart a drop and its glass can be and still flow together; the
 * neck thins as the drop reaches its place, so it pinches off and rests as
 * its own shape even right beside its source. */
export const neckWidth = (p: number, neck: number) => neck * (1 - smoothstep(0.3, 0.95, p));

/** One prepared shape on the path. */
export interface MorphStop {
  p: number;
  shape: MorphGeometry;
  /** Drawn in this box rather than stretched to the live outline: a traced
   * union, or the glass a drop is still inside. */
  box?: Box;
  /** Draws the source glass as part of itself. */
  absorbs: boolean;
}
export interface MorphPlanOptions {
  /** Shapes prepared between the endpoints. */
  stops?: number;
  /** Union samples while a drop is joined to its glass. */
  unions?: number;
  /** Neck reach in pixels. */
  neck?: number;
  /** Map density of the shapes in motion. */
  dpr?: number;
  /** Map density of the resting endpoints. */
  restDpr?: number;
}
/** The glass a drop detaches from. `width` and `height` are its layout size
 * and `radius` its declared corners, so its stop matches its own resting map. */
export interface MorphGlass extends Box { radius: GlassRadius; layoutWidth: number; layoutHeight: number }
const round = (v: number, unit: number) => Math.round(v / unit) * unit;
/** Plan the shapes an animation passes through, so their maps can be
 * prepared together before it starts. Stops are spaced evenly by how much
 * the shape changes between them; the endpoints are exact. A drop leaving
 * glass adds the traced unions of the two while they are joined, beginning
 * with the glass's own shape while the drop is still inside it. */
export function planMorph(e: MorphEndpoints, glass: MorphGlass | undefined, options: MorphPlanOptions = {}): MorphStop[] {
  const { stops: count = 14, unions = 16, neck = 18, dpr = 1, restDpr = dpr } = options;
  const fine = 240;
  const shapes = Array.from({ length: fine + 1 }, (_, i) => morphShape(e, i / fine));
  const plain = (p: number, s: MorphShape, exact: boolean): MorphStop => {
    const width = exact ? s.width : Math.max(1, Math.round(s.width)), height = exact ? s.height : Math.max(1, Math.round(s.height));
    const radius = round(Math.min(s.radius, width / 2, height / 2), 0.5);
    const capsule = radius >= Math.min(width, height) / 2 - 0.25;
    return { p, shape: { width, height, radius: capsule ? "capsule" : radius, dpr }, absorbs: false };
  };
  const result: MorphStop[] = [];
  // Distance travelled along the path, for even spacing.
  const travelled = [0];
  for (let i = 1; i <= fine; i++) travelled.push(travelled[i - 1]! + shapeDistance(shapes[i]!, shapes[i - 1]!));
  const total = travelled[fine]!;
  let next = 1;
  for (let i = 1; i < fine && total > 0; i++) {
    if (travelled[i]! >= total * next / (count - 1) && next < count - 1) { result.push(plain(i / fine, shapes[i]!, false)); next++; }
  }
  const first: MorphStop = { p: 0, shape: { width: e.from.width, height: e.from.height, radius: e.fromRadius, dpr: restDpr, resting: true }, absorbs: false };
  const last: MorphStop = { p: 1, shape: { width: e.to.width, height: e.to.height, radius: e.toRadius, dpr: restDpr, resting: true }, absorbs: false };
  if (!glass) return [first, ...result, last];
  // A drop inside its glass is the glass; joined to it, their union.
  const own: RoundRect = { x: glass.left, y: glass.top, width: glass.width, height: glass.height, radius: radiusPixels(glass.radius, glass.width, glass.height) };
  const joined = (i: number) => {
    const s = shapes[i]!, k = neckWidth(i / fine, neck);
    return !contains(glass, s) && k >= 1 && boxGap(glass, s) <= k;
  };
  let start = -1, end = -1;
  for (let i = 0; i <= fine; i++) {
    if (!joined(i)) { if (start >= 0) break; continue; }
    if (start < 0) start = i;
    end = i;
  }
  if (start < 0) return [first, ...result, last];
  const inside: MorphStop = { p: Math.max(0, start - 1) / fine, shape: { width: glass.layoutWidth, height: glass.layoutHeight, radius: glass.radius, dpr: restDpr, resting: true }, box: { ...glass }, absorbs: true };
  const samples = Math.max(2, Math.min(unions, Math.ceil((end - start) / fine / 0.025) + 1));
  const traced: MorphStop[] = [];
  for (let j = 0; j < samples; j++) {
    const i = Math.round(mix(start, end, j / (samples - 1)));
    const s = shapes[i]!, p = i / fine;
    const loops = smoothUnion([own, { x: s.left, y: s.top, width: s.width, height: s.height, radius: s.radius }], neckWidth(p, neck), 1.5, 700);
    if (loops.length !== 1) continue;
    const outline = loops[0]!;
    const left = Math.floor(Math.min(...outline.map(([x]) => x))), top = Math.floor(Math.min(...outline.map(([, y]) => y)));
    const right = Math.ceil(Math.max(...outline.map(([x]) => x))), bottom = Math.ceil(Math.max(...outline.map(([, y]) => y)));
    traced.push({ p, shape: { width: right - left, height: bottom - top, radius: 0, outline: outline.map(([x, y]): ShapePoint => [x - left, y - top]), dpr }, box: { left, top, width: right - left, height: bottom - top }, absorbs: true });
  }
  if (!traced.length) return [first, ...result, last];
  // Once pinched off, the drop is its own shape from where it parted.
  const parted = plain(Math.min(1, (end + 1) / fine), shapes[Math.min(fine, end + 1)]!, false);
  const after = result.filter((stop) => stop.p > parted.p);
  return [inside, ...traced, parted, ...after, last];
}

/** What to draw at progress `p`: the two stops around it and their blend,
 * plus how much of the source glass the frame draws in its place. */
export interface MorphDraw { a: MorphStop; b?: MorphStop; mix: number; absorb: number }
export function morphDraw(stops: readonly MorphStop[], p: number): MorphDraw | undefined {
  if (!stops.length || p < stops[0]!.p - 1e-9) return;
  let i = 0;
  while (i + 1 < stops.length && stops[i + 1]!.p <= p) i++;
  const a = stops[i]!, b = stops[i + 1];
  if (!b || b.p <= a.p) return { a, mix: 0, absorb: a.absorbs ? 1 : 0 };
  const t = Math.min(1, Math.max(0, (p - a.p) / (b.p - a.p)));
  return { a, b, mix: t, absorb: (a.absorbs ? 1 - t : 0) + (b.absorbs ? t : 0) };
}
