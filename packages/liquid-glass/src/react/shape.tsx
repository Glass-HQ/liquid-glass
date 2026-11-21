import { useLayoutEffect, useRef } from "react";
import type { HTMLAttributes, Ref, RefObject } from "react";
import { useRender } from "@base-ui/react/use-render";
import { observeFixedShape } from "../dom/fixed-shape.js";
import type { GlassRadius } from "../core/shape.js";
import {
  observeConcentricShape,
  observeCornerPlacement,
  shapeContainerAttributes,
} from "../dom/shape-layout.js";
import type { ConcentricOptions, CornerOptions } from "../dom/shape-layout.js";
export interface GlassShapeProps extends HTMLAttributes<HTMLElement> {
  radius?: GlassRadius;
  render?: useRender.RenderProp;
  ref?: Ref<HTMLElement>;
  /** Follow the nearest declared shape container. */
  concentric?: boolean | ConcentricOptions;
  container?: RefObject<HTMLElement | null>;
}
export interface GlassRowProps extends Omit<
  GlassShapeProps,
  "concentric" | "container" | "radius"
> {
  /** Room between the row's content and the curve of the corner it nears. Default: 8. */
  contentPadding?: number;
}
/**
 * A row in a glass panel, such as a menu's item, a select's option or a palette's result: where
 * it nears the panel's corners it follows their curve moved inward (concentric), and its side
 * padding keeps its content clear of that curve. Render any element as the row with `render`.
 */
export function GlassRow({ contentPadding = 8, ...props }: GlassRowProps) {
  return <GlassShape {...props} concentric={{ contentPadding }} />;
}
export function GlassShape({ concentric, container, ...props }: GlassShapeProps) {
  return concentric ? (
    <ConcentricShape {...props} concentric={concentric} container={container} />
  ) : (
    <FixedShape {...props} />
  );
}
function FixedShape({ radius = 8, render, ref, style, ...props }: GlassShapeProps) {
  const element = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (!element.current) return;
    return observeFixedShape(element.current, radius);
  }, [radius]);
  return useRender({
    render,
    ref: [element, ref ?? null],
    props: {
      ...props,
      ...shapeContainerAttributes(radius),
      "data-lg-shape": "",
      style: { ...style, borderRadius: 0 },
    },
  });
}
function ConcentricShape({
  radius,
  concentric,
  container,
  render,
  ref,
  style,
  ...props
}: GlassShapeProps) {
  const element = useRef<HTMLElement>(null);
  const config = typeof concentric === "object" ? concentric : {};
  const options = JSON.stringify({ ...config, radius: radius ?? config.radius ?? 8 });
  useLayoutEffect(() => {
    if (!element.current) return;
    return observeConcentricShape(
      element.current,
      JSON.parse(options),
      container ? () => container.current : undefined,
    );
  }, [options, container]);
  return useRender({
    render,
    ref: [element, ref ?? null],
    props: {
      ...props,
      ...shapeContainerAttributes(radius ?? config.radius ?? 8),
      "data-lg-shape": "",
      "data-lg-concentric": "",
      style: { ...style, borderRadius: 0 },
    },
  });
}
/** Declare an unclipped layout boundary for sibling content and overlays. */
export function GlassShapeContainer({
  radius = 8,
  render,
  ref,
  ...props
}: Omit<GlassShapeProps, "concentric" | "container">) {
  return useRender({
    render,
    ref: ref ?? null,
    props: { ...props, ...shapeContainerAttributes(radius) },
  });
}
export interface GlassCornerProps extends HTMLAttributes<HTMLElement>, CornerOptions {
  enabled?: boolean;
  render?: useRender.RenderProp;
  ref?: Ref<HTMLElement>;
  container?: RefObject<HTMLElement | null>;
}
/** Position a fixed-size control with clearance from its container's curve. */
export function GlassCorner({
  enabled = true,
  corner = "top-right",
  gap = 8,
  radius = "circle",
  container,
  render,
  ref,
  style,
  ...props
}: GlassCornerProps) {
  const element = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (!element.current) return;
    if (!enabled) return;
    return observeCornerPlacement(
      element.current,
      { corner, gap, radius },
      container ? () => container.current : undefined,
    );
  }, [corner, gap, radius, container, enabled]);
  return useRender({
    render,
    ref: [element, ref ?? null],
    props: { ...props, "data-lg-corner": corner, style: { position: "absolute", ...style } },
  });
}
