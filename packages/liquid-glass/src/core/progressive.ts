export type GlassBlurEdge = "top" | "bottom" | "inline-start" | "inline-end";
export type PhysicalEdge = "top" | "bottom" | "left" | "right";
export interface ProgressiveBlurOptions {
  /** Edge where blur is strongest. Default: bottom. */
  edge?: GlassBlurEdge;
  /** Depth in CSS pixels. Default: 80. Clamped to half the viewport for scroll edges. */
  size?: number;
  /** Maximum Gaussian standard deviation in CSS pixels. Default: 20. */
  blur?: number;
  /** Maximum optical travel in CSS pixels. Default: 0. */
  refraction?: number;
  disabled?: boolean;
}
export function validateProgressive(options: ProgressiveBlurOptions): void {
  for (const [name, value, max] of [
    ["size", options.size ?? 80, 4096],
    ["blur", options.blur ?? 20, 64],
    ["refraction", options.refraction ?? 0, 32],
  ] as const) {
    if (!Number.isFinite(value) || value < 0 || value > max)
      throw new RangeError(`${name} must be finite and between 0 and ${max}.`);
  }
  if (
    options.edge &&
    !["top", "bottom", "inline-start", "inline-end"].includes(options.edge)
  )
    throw new RangeError("Unknown progressive blur edge.");
}
export function physicalEdge(edge: GlassBlurEdge, rtl: boolean): PhysicalEdge {
  if (edge === "inline-start") return rtl ? "right" : "left";
  if (edge === "inline-end") return rtl ? "left" : "right";
  return edge;
}
/** Clamp Safari rubber-banding; RTL scrollLeft is negative in modern engines. */
export function scrollEdgeStrength(
  edge: PhysicalEdge,
  left: number,
  top: number,
  maxX: number,
  maxY: number,
  rtl: boolean,
  size: number,
): number {
  const x = Math.max(0, Math.min(maxX, rtl ? maxX + left : left));
  const y = Math.max(0, Math.min(maxY, top));
  const distance =
    edge === "top"
      ? y
      : edge === "bottom"
        ? maxY - y
        : edge === "left"
          ? x
          : maxX - x;
  const t = Math.max(
    0,
    Math.min(1, distance / Math.max(1, Math.min(size, 32))),
  );
  return t * t * (3 - 2 * t);
}
