export { createGlassScene } from "./scene/scene";
export type {
  GlassScene,
  GlassSceneOptions,
  GlassSurfaceHandle,
  GlassTone,
  SurfaceOptions,
} from "./scene/scene";
export type { DragPad, DragPadHandlers, Point } from "./scene/ios/drag-pad";
export type { Telemetry, TelemetryReport, TelemetryCounters } from "./scene/telemetry";
export { TelemetryCounter } from "./scene/telemetry";

export * from "./motion/index";

export {
  createSpring,
  springTo,
  springSet,
  stepSpring,
  solveSpring,
  clamped,
  cubicBezier,
} from "./core/spring";
export type { Spring, SpringParams } from "./core/spring";
export { rubberBand, rubberBandInverse, rubberBandPull } from "./core/rubber-band";
export {
  capsuleRadii,
  concentricRadii,
  fitRadii,
  fromBox,
  mixRect,
  outset,
  resolveRadii,
  scaleRect,
  toBox,
  uniformRadii,
} from "./core/geometry";
export type { Box, RadiusSpec } from "./core/geometry";
export type { TintAmount } from "./core/material";

export type {
  Appearance,
  Material,
  MaterialKind,
  Radii,
  Rect,
  Rgba,
  Shape,
  ShapeRole,
} from "./protocol";
