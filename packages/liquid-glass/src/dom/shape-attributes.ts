import { cornerOptions } from "../core/corner-options.js";
import type { GlassRadius } from "../core/corner-options.js";

/** The attributes that make an element a shape container other glass follows (concentric). */
export function shapeContainerAttributes(radius: GlassRadius) {
  cornerOptions(radius);
  return { "data-lg-container": "", "data-lg-container-radius": String(radius) };
}
