export { edgeDisplacement } from "./optics.js";
export { materials } from "./materials.js";
export type { MaterialOptions, GlassMaterial, GlassAppearance } from "./materials.js";

export type { GlassRadius } from "./shape.js";

export {
  insetShape,
  concentricOutline,
  cornerPlacement,
  contentInsets,
  polygonClip,
} from "./concentric.js";
export type { ShapeGeometry, ShapeBounds, ShapePoint } from "./concentric.js";

export { Spring, springs, settleTime, rubberBand } from "./spring.js";
export type { SpringOptions } from "./spring.js";
