import { generatePath, generateClipPath } from "@lisse/core";
import type { SmoothCornerOptions } from "@lisse/core";

/** A fixed continuous corner, a continuous capsule, or a circular cap. */
export type GlassRadius = number | "capsule" | "circle";
export function cornerOptions(radius: GlassRadius): SmoothCornerOptions {
  if (typeof radius !== "number" && radius !== "capsule" && radius !== "circle")
    throw new RangeError("Unknown glass radius.");
  if (typeof radius === "number" && (!Number.isFinite(radius) || radius < 0))
    throw new RangeError("Corner radius must be finite and nonnegative.");
  return { radius: typeof radius === "number" ? radius : Number.MAX_SAFE_INTEGER,
    smoothing: 0.8125, preserveSmoothing: true,
    curve: radius === "circle" ? "arc" : "squircle" };
}
/** Lisse path generation is not cheap, and a page repeats the same few
 * shapes many times over, so results are memoized by exact geometry. */
const memo = new Map<string, string>();
function remember(key: string, make: () => string): string {
  let value = memo.get(key);
  if (value === undefined) {
    value = make();
    if (memo.size >= 1024) memo.delete(memo.keys().next().value!);
    memo.set(key, value);
  }
  return value;
}
export function shapePath(width: number, height: number, radius: GlassRadius): string {
  return remember(`p|${width}|${height}|${radius}`, () => generatePath(width, height, cornerOptions(radius)));
}
export function shapeClip(width: number, height: number, radius: GlassRadius): string {
  return remember(`c|${width}|${height}|${radius}`, () => generateClipPath(width, height, cornerOptions(radius)));
}

type Point = [number, number];
/** Tessellate Lisse's SVG path for the WGSL distance field. This is the same
 * outline used by the DOM, not a second corner formula. Uniform shapes are
 * symmetric, so the GPU only needs the top-right quadrant. */
export function shapePolygon(width: number, height: number, radius: GlassRadius): Point[] {
  const tokens = shapePath(width, height, radius).match(/[a-zA-Z]|[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/g)!;
  const points: Point[] = [];
  let index = 0, pen: Point = [0, 0], start: Point = [0, 0];
  const number = () => Number(tokens[index++]);
  const point = (): Point => [number(), number()];
  const add = (p: Point) => { points.push(p); pen = p; };
  while (index < tokens.length) {
    const command = tokens[index++];
    if (command === "M") { add(point()); start = pen; }
    else if (command === "L") add(point());
    else if (command === "H") add([number(), pen[1]]);
    else if (command === "V") add([pen[0], number()]);
    else if (command === "c") {
      const origin = pen, a = point(), b = point(), end = point();
      for (let step = 1; step <= 32; step++) {
        const t = step / 32, u = 1 - t;
        add([origin[0] + 3*u*u*t*a[0] + 3*u*t*t*b[0] + t*t*t*end[0],
          origin[1] + 3*u*u*t*a[1] + 3*u*t*t*b[1] + t*t*t*end[1]]);
      }
    } else if (command === "a") {
      const r = number(), ry = number(), rotation = number(), large = number(), sweep = number(), delta = point();
      if (r !== ry || rotation !== 0 || large !== 0 || sweep !== 1)
        throw new Error("Unsupported Lisse arc geometry.");
      const origin = pen, chord = Math.hypot(...delta);
      if (chord < 1e-8) continue;
      const offset = Math.sqrt(Math.max(0, r*r - chord*chord/4));
      const center: Point = [origin[0]+delta[0]/2-delta[1]/chord*offset, origin[1]+delta[1]/2+delta[0]/chord*offset];
      const angle = Math.atan2(origin[1]-center[1], origin[0]-center[0]);
      const extent = 2*Math.asin(Math.min(1, chord/(2*r)));
      for (let step = 1; step <= 32; step++) {
        const theta = angle + extent*step/32;
        add([center[0]+r*Math.cos(theta), center[1]+r*Math.sin(theta)]);
      }
    } else if (command === "Z") add(start);
    else throw new Error(`Unsupported Lisse path command: ${command}`);
  }
  return points;
}

export function shapeSegments(width: number, height: number, radius: GlassRadius) {
  const points = shapePolygon(width, height, radius);
  // Lisse serializes coordinates to four decimals. Snap symmetry-axis
  // rounding residue at the axes and bounds before clipping so path closure
  // and the opposite quadrant leave no slivers.
  for (const point of points) {
    for (const bound of [0, width]) if (Math.abs(point[0] - bound) < 0.0002) point[0] = bound;
    for (const bound of [0, height]) if (Math.abs(point[1] - bound) < 0.0002) point[1] = bound;
    if (Math.abs(point[0] - width / 2) < 0.0002) point[0] = width / 2;
    if (Math.abs(point[1] - height / 2) < 0.0002) point[1] = height / 2;
  }
  const segments: number[][] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i-1]!, b = points[i]!;
    const dx = b[0]-a[0], dy = b[1]-a[1];
    let lo = 0, hi = 1;
    // Clip each edge to x >= width/2 and y <= height/2.
    for (const [origin, direction, bound, greater] of [[a[0],dx,width/2,1],[a[1],dy,height/2,-1]]) {
      if (Math.abs(direction!) < 1e-8) { if ((origin!-bound!)*greater! < -1e-6) hi = -1; }
      else {
        const t = (bound!-origin!)/direction!;
        if (direction!*greater! > 0) lo = Math.max(lo,t); else hi = Math.min(hi,t);
      }
    }
    if (hi <= lo || Math.hypot(dx,dy)*(hi-lo) < 1e-6) continue;
    segments.push([a[0]+dx*lo,a[1]+dy*lo,a[0]+dx*hi,a[1]+dy*hi]);
  }
  const count = segments.length;
  if (count > 128 || !count) throw new RangeError("Lisse outline exceeds the GPU segment budget.");
  return { segments, count };
}
