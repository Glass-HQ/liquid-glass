import { useCallback, useLayoutEffect } from "react";
import type { CSSProperties, ComponentPropsWithRef, RefObject } from "react";
import { useRender } from "@base-ui/react/use-render";
import type { GlassBlurEdge, ProgressiveBlurOptions } from "../core/progressive.js";
import { validateProgressive } from "../core/progressive.js";
import { useScene } from "./scene.js";
export interface GlassProgressiveBlurProps extends ProgressiveBlurOptions,
  Omit<ComponentPropsWithRef<"div">, "children"> { children?: never }
/** A decorative region affecting the scene's explicit GlassContent only. */
export function GlassProgressiveBlur({ edge = "bottom", size = 80, blur = 20,
  refraction = 0, disabled = false, className = "", style, ref, ...props
}: GlassProgressiveBlurProps) {
  const { controller } = useScene();
  validateProgressive({ edge, size, blur, refraction });
  const attach = useCallback((element: HTMLDivElement | null) => {
    if (element) return controller.addProgressiveBlur(element, { edge, size, blur, refraction, disabled });
  }, [controller, edge, size, blur, refraction, disabled]);
  return useRender({ ref: [attach, ref ?? null], props: {
    ...props, "aria-hidden": true, "data-edge": edge,
    className: `lg-progressive-blur ${className}`,
    style: { "--lg-blur-size": `${size}px`, ...style, pointerEvents: "none" } as CSSProperties,
  } });
}
export interface GlassScrollEdgesProps extends Omit<ProgressiveBlurOptions, "edge"> {
  /** The existing scroll container. Does not create or replace scrolling. */
  target: RefObject<HTMLElement | null>;
  edges?: readonly GlassBlurEdge[];
}
const defaultBlurEdges: readonly GlassBlurEdge[] = ["top", "bottom"];
/** Filters only the target scrollport. Place floating controls outside that
 * element to keep them sharp; no extra viewport wrapper is required. */
export function GlassScrollEdges({ target, edges = defaultBlurEdges, size = 80,
  blur = 20, refraction = 0, disabled = false }: GlassScrollEdgesProps) {
  const { controller } = useScene();
  validateProgressive({ size, blur, refraction });
  edges.forEach((edge) => validateProgressive({ edge }));
  const edgeKey = [...new Set(edges)].join(",");
  useLayoutEffect(() => controller.addScrollEdges({
    target: () => target.current,
    edges: edgeKey ? edgeKey.split(",") as GlassBlurEdge[] : [], size, blur, refraction, disabled,
  }), [controller, target, edgeKey, size, blur, refraction, disabled]);
  return null;
}
