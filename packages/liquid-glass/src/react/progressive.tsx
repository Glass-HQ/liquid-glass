import type { ComponentPropsWithRef } from "react";
import type { BlurEdge } from "../protocol";
import { useGlassSurface, useMergedRef } from "./hooks";

export interface GlassProgressiveBlurProps extends ComponentPropsWithRef<"div"> {
  /** The side the blur is strongest at; it fades out towards the opposite side. Default: "top". */
  edge?: BlurEdge;
  /** CSS color the blur fades into at its strong side, its alpha the strength (a bar's color). */
  tint?: string | null;
  /**
   * For content on a see-through surface (a pane over a translucent window). Laid over such
   * content, a blur lets the sharp content show through it. With `replace` the blur draws only
   * the content, as see-through as it was, and the content itself is hidden under it: give the
   * element holding the content `mask-image: progressiveBlurMask(...)`.
   */
  replace?: boolean;
}

/**
 * A progressive blur: what is behind the element is blurred most at one side and not at all at
 * the other, the way content softens as it scrolls under a toolbar. The scene's renderer draws
 * it, like glass, so it costs what a glass surface of its size costs. Size and place it with CSS
 * (it is a plain `div`, `pointer-events: none` by default), inside a `GlassScene`.
 */
export function GlassProgressiveBlur({
  edge = "top",
  tint = null,
  replace = false,
  ref,
  style,
  ...props
}: GlassProgressiveBlurProps) {
  const { ref: surfaceRef } = useGlassSurface({
    edge: { side: edge, replace },
    tint,
    radius: 0,
    adaptive: false,
    body: true,
    material: undefined,
    smoothing: undefined,
    labelsInGlass: undefined,
    bleed: 0,
    floating: undefined,
    appearance: undefined,
    overhang: undefined,
    lensHeight: undefined,
  });
  const mergedRef = useMergedRef<HTMLDivElement>(surfaceRef, ref);
  return (
    <div
      aria-hidden="true"
      data-lg-progressive=""
      {...props}
      ref={mergedRef}
      style={{ pointerEvents: "none", ...style }}
    />
  );
}
