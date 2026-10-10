import { mapPlanes } from "./planes.js";
import type { GlassRadius } from "../core/shape.js";
import type { ShapePoint } from "../core/concentric.js";
export interface MapGeometry {
  /** Resolved convex outline for container-relative glass, in local CSS pixels. */
  outline?: ShapePoint[];
  width: number;
  height: number;
  radius: GlassRadius;
  dpr?: number;
  appearance?: "light" | "dark";
}
export const maxAtlasRows = 8192;
/** Pixels per CSS pixel a map is rendered at. Maps are stretched to their
 * surface when drawn, so a surface too large for the atlas at the display's
 * ratio, such as a full-height panel on a 2x or 3x display, renders at a
 * lower ratio instead of failing. */
export function mapScale(g: MapGeometry): number {
  const dpr = Math.max(1, Math.min(g.dpr ?? 1, 2));
  const fit = Math.min(1, 4096 / ((g.width + 4) * dpr), (maxAtlasRows / mapPlanes) / ((g.height + 4) * dpr));
  return fit < 1 ? Math.max(0.25, dpr * fit) : dpr;
}
