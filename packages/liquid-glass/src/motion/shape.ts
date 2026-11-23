import type { Radii, Rect, Rgba, Shape, ShapeRole } from "../protocol";

/** A shape with everything but its role, rect and corners at rest. */
export const shape = (
  role: ShapeRole,
  rect: Rect,
  radii: Radii,
  extra: {
    lift?: number;
    magnify?: number;
    alpha?: number;
    merge?: number;
    tint?: Rgba | null;
    light?: number;
    smoothing?: number;
  } = {},
): Shape => ({
  role,
  rect,
  radii,
  lift: extra.lift ?? 0,
  magnify: extra.magnify ?? 1,
  alpha: extra.alpha ?? 1,
  merge: extra.merge ?? 0,
  tint: extra.tint ?? null,
  light: extra.light ?? 0,
  ...(extra.smoothing === undefined ? {} : { smoothing: extra.smoothing }),
});

/** Shapes that differ by less than this are the same frame; nothing needs posting. */
export function sameShapes(a: readonly Shape[], b: readonly Shape[], epsilon = 1e-3): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const p = a[i];
    const q = b[i];
    if (!p || !q) return false;
    if (p.role !== q.role || p.tint !== q.tint || p.smoothing !== q.smoothing) return false;
    const numbers = [
      p.rect.x - q.rect.x,
      p.rect.y - q.rect.y,
      p.rect.width - q.rect.width,
      p.rect.height - q.rect.height,
      p.radii[0] - q.radii[0],
      p.radii[1] - q.radii[1],
      p.radii[2] - q.radii[2],
      p.radii[3] - q.radii[3],
      p.lift - q.lift,
      p.magnify - q.magnify,
      p.alpha - q.alpha,
      p.merge - q.merge,
      p.light - q.light,
    ];
    for (const d of numbers) if (Math.abs(d) > epsilon) return false;
  }
  return true;
}
