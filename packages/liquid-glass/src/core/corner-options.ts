import type { CornerOptions } from "./corner-path.js";

/** A fixed continuous corner, a continuous capsule, or a circular cap. */
export type GlassRadius = number | "capsule" | "circle";
export function cornerOptions(radius: GlassRadius): CornerOptions {
  if (typeof radius !== "number" && radius !== "capsule" && radius !== "circle")
    throw new RangeError("Unknown glass radius.");
  if (typeof radius === "number" && (!Number.isFinite(radius) || radius < 0))
    throw new RangeError("Corner radius must be finite and nonnegative.");
  return {
    radius: typeof radius === "number" ? radius : Number.MAX_SAFE_INTEGER,
    smoothing: 0.8125,
    preserveSmoothing: true,
    curve: radius === "circle" ? "arc" : "squircle",
  };
}
