import { shapePolygon } from "./shape.js";
import type { GlassRadius } from "./shape.js";
export type ShapePoint = [number, number];
export interface ShapeBounds { x: number; y: number; width: number; height: number }
export interface ShapeGeometry { width: number; height: number; radius: GlassRadius; outline?: ShapePoint[] }

/** Inward parallel offset of the convex Lisse outline, in CSS pixels. */
export function insetShape(shape: ShapeGeometry, inset: number): ShapePoint[] {
  if (!Number.isFinite(inset) || inset < 0) throw new RangeError("Shape inset must be finite and nonnegative.");
  if (shape.outline && !shape.outline.length) return [];
  const outline = shape.outline ? [...shape.outline,shape.outline[0]!] : shapePolygon(shape.width, shape.height, shape.radius);
  let result: ShapePoint[] = [[0, 0], [shape.width, 0], [shape.width, shape.height], [0, shape.height]];
  for (let i = 1; i < outline.length; i++) {
    const a = outline[i - 1]!, b = outline[i]!;
    const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
    if (length < 0.0002) continue;
    result = halfPlane(result, -dy / length, dx / length, (-dy * a[0] + dx * a[1]) / length + inset);
    if (!result.length) break;
  }
  return result;
}
function halfPlane(points: ShapePoint[], nx: number, ny: number, limit: number): ShapePoint[] {
  const result: ShapePoint[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!, b = points[(i + 1) % points.length]!;
    const da = a[0] * nx + a[1] * ny - limit, db = b[0] * nx + b[1] * ny - limit;
    if (da >= -1e-7) result.push(a);
    if ((da < 0) !== (db < 0)) {
      const t = da / (da - db);
      result.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return result;
}
/** Child-local outline: keep its own corners away from the container edge,
 * and inherit the container's parallel curve wherever the two meet. */
export function concentricOutline(parent: ShapePoint[], bounds: ShapeBounds, radius: GlassRadius = 8): ShapePoint[] {
  let result = shapePolygon(bounds.width, bounds.height, radius).map(([x, y]): ShapePoint => [x + bounds.x, y + bounds.y]);
  for (let i = 0; i < parent.length; i++) {
    const a = parent[i]!, b = parent[(i + 1) % parent.length]!;
    const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
    if (length < 1e-7) continue;
    result = halfPlane(result, -dy / length, dx / length, (-dy * a[0] + dx * a[1]) / length);
  }
  return result.map(([x, y]) => [Math.round((x - bounds.x) * 10000) / 10000, Math.round((y - bounds.y) * 10000) / 10000]);
}
export function polygonClip(points: ShapePoint[]): string {
  return points.length ? `polygon(${points.map(([x, y]) => `${x.toFixed(3)}px ${y.toFixed(3)}px`).join(",")})` : "polygon(0px 0px,0px 0px,0px 0px)";
}
function inside(points: ShapePoint[], x: number, y: number) {
  return points.every((a, i) => { const b = points[(i + 1) % points.length]!; return (b[0]-a[0])*(y-a[1])-(b[1]-a[1])*(x-a[0]) >= -0.001; });
}
/** Equal-edge inset that fits an entire fixed-size control inside a corner. */
export function cornerPlacement(shape: ShapeGeometry, width: number, height: number, gap: number, radius: GlassRadius = "circle") {
  const parent = insetShape(shape, gap), child = shapePolygon(width, height, radius);
  const fits = (d: number) => parent.length > 0 && child.every(([x,y]) => inside(parent, x+d, y+d));
  const maximum = Math.min((shape.width-width)/2, (shape.height-height)/2);
  if (maximum < 0 || !fits(maximum)) throw new RangeError("The control does not fit inside its shape container.");
  let lo = 0, hi = maximum;
  for (let i=0;i<24;i++) { const mid=(lo+hi)/2; if(fits(mid)) hi=mid; else lo=mid; }
  return hi;
}
/** Horizontal clearance for a centered content band inside a clipped row. */
export function contentInsets(points: ShapePoint[], width: number, height: number, bandHeight: number) {
  const rows = [(height-Math.min(height,bandHeight))/2, (height+Math.min(height,bandHeight))/2];
  let left=0, right=width;
  for(const y of rows) {
    const xs: number[]=[];
    for(let i=0;i<points.length;i++) { const a=points[i]!,b=points[(i+1)%points.length]!;
      if(Math.abs(a[1]-b[1])<1e-7) { if(Math.abs(y-a[1])<1e-5) xs.push(a[0],b[0]); }
      else if(y>=Math.min(a[1],b[1])&&y<=Math.max(a[1],b[1])) xs.push(a[0]+(b[0]-a[0])*(y-a[1])/(b[1]-a[1]));
    }
    if(xs.length) {left=Math.max(left,Math.min(...xs));right=Math.min(right,Math.max(...xs));}
  }
  return {left,right:width-right};
}

/** Uniform storage for an asymmetric convex contour used by the GPU field. */
export function outlineSegments(points: ShapePoint[]) {
  const segments: number[][]=[];
  for(let i=0;i<points.length;i++) {
    const a=points[i]!,b=points[(i+1)%points.length]!;
    if(![...a,...b].every(Number.isFinite)) throw new RangeError("Outline coordinates must be finite.");
    if(Math.hypot(b[0]-a[0],b[1]-a[1])>0.00001) segments.push([...a,...b]);
  }
  const count=segments.length;
  if(count<3 || count>1024) throw new RangeError("A glass outline needs between 3 and 1024 edges.");
  return {segments,count};
}
