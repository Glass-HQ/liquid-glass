/**
 * The geometry of shapes: clip paths for fixed and concentric corners, and corner placement.
 * Loaded when the first shape mounts, not with the components that declare shapes.
 */
export { observeFixedShape } from "./fixed-shape.js";
export { observeConcentricShape, observeCornerPlacement } from "./shape-layout.js";
