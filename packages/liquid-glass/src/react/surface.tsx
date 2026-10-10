import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import type { CSSProperties, HTMLAttributes, Ref, RefObject } from "react";
import { useRender } from "@base-ui/react/use-render";
import { shapeContainerAttributes } from "../dom/shape-layout.js";
import type { GlassMotion, GlassMorph } from "../dom/index.js";
import type { MaterialOptions } from "../core/materials.js";
import { useScene } from "./scene.js";
/** How a glass surface moves. Every option is available to any surface. */
export interface GlassMotionProps {
  /** Respond to touch and pointer input: grow under a press, stretch toward a
   * drag, settle with overshoot on release, and light up beneath the pointer. */
  interactive?: boolean;
  /** Grow out of this element when mounted, and shrink back into it when a
   * Base UI popup closes. */
  morphFrom?: RefObject<Element | null> | (() => Element | null | undefined);
  /** How the surface relates to the glass it grows from. `become`: the
   * source's glass is this surface; its content withdraws while the surface
   * is present. `detach`: the surface leaves the source's glass as a drop,
   * joined by a liquid neck until they part. Default: a glass source is
   * become; a source inside glass, such as a toolbar button, is detached from. */
  morph?: GlassMorph;
  /** How far a detaching surface stays joined to its glass by a liquid neck,
   * in pixels. `0` grows a plain shape with no union. Default: 18. */
  neck?: number;
  /** Grow out of `morphFrom` when mounted. `false` keeps only the exit, for
   * an element that is already in place. Default: true. */
  morphEnter?: boolean;
  /** Spring the glass outline when the surface's layout box changes. */
  fluid?: boolean;
  /** Override the scene's motion level for this surface. */
  motion?: GlassMotion;
}
export interface GlassSurfaceProps
  extends HTMLAttributes<HTMLElement>, MaterialOptions, GlassMotionProps {
  render?: useRender.RenderProp;
  ref?: Ref<HTMLElement>;
}
/** Pass a shadcn component with render={<Button/>}; geometry follows its real DOM. */
export function GlassSurface({
  material,
  appearance,
  radius,
  concentric,
  refraction,
  tint,
  interactive = false,
  morphFrom,
  morph,
  neck,
  morphEnter,
  fluid = false,
  motion,
  render,
  ref,
  children,
  className = "",
  style,
  ...props
}: GlassSurfaceProps) {
  const scene = useScene();
  const { controller } = scene;
  material ??= scene.material;
  appearance ??= scene.appearance;
  motion ??= scene.motion;
  const relative = Boolean(concentric);
  const inset = typeof concentric === "object" ? concentric.inset : undefined;
  // The source is read when the surface mounts or leaves; a new function or
  // ref identity must not register the surface again.
  const source = useRef(morphFrom);
  useLayoutEffect(() => { source.current = morphFrom; });
  const morphs = Boolean(morphFrom);
  const options = useMemo(
    () => ({
      material, appearance, radius, concentric: relative ? { inset } : undefined, refraction, tint,
      interactive, fluid, motion, morph, neck, morphEnter,
      morphFrom: morphs ? () => {
        const from = source.current;
        return typeof from === "function" ? from() : from?.current;
      } : undefined,
    }),
    [material, appearance, radius, relative, inset, refraction, tint, interactive, fluid, motion, morph, neck, morphEnter, morphs],
  );
  const attach = useCallback(
    (element: HTMLElement | null) => {
      if (!element) return;
      const remove = controller.addSurface(element, options);
      return () => {
        remove();
      };
    },
    [controller, options],
  );
  return useRender({
    render,
    ref: [attach, ref ?? null],
    props: {
      ...props,
      ...shapeContainerAttributes(radius ?? 8),
      "data-glass-material": material,
      "data-glass-appearance": appearance,
      "data-glass-interactive": interactive ? "" : undefined,
      className: `lg-surface ${className}`,
      style: {
        ...style,
      } as CSSProperties,
      ...(children === undefined ? {} : { children }),
    },
  });
}
