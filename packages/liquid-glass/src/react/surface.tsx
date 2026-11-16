import { useCallback, useMemo } from "react";
import type { CSSProperties, HTMLAttributes, Ref } from "react";
import { useRender } from "@base-ui/react/use-render";
import { shapeContainerAttributes } from "../dom/shape-layout.js";
import type { GlassMotion } from "../dom/index.js";
import type { MaterialOptions } from "../core/materials.js";
import { useScene } from "./scene.js";
/** How a glass surface moves. Every option is available to any surface. */
export interface GlassMotionProps {
  /** Respond to touch and pointer input: grow under a press, stretch toward a
   * drag, settle with overshoot on release, and light up beneath the pointer. */
  interactive?: boolean;
  /** Override the scene's motion level for this surface. */
  motion?: GlassMotion;
}
export interface GlassSurfaceProps
  extends HTMLAttributes<HTMLElement>, MaterialOptions, GlassMotionProps {
  render?: useRender.RenderProp;
  ref?: Ref<HTMLElement>;
}
/** Pass a shadcn component with render={<Button/>}; geometry follows its real DOM. */
export function GlassSurface(props: GlassSurfaceProps) {
  return <Surface {...props} />;
}
/** A menu popup: its scene rises above sibling scenes while it is open. */
export function GlassPopupSurface(props: GlassSurfaceProps) {
  return <Surface {...props} popup />;
}
function Surface({
  material,
  appearance,
  radius,
  concentric,
  refraction,
  tint,
  specular,
  interactive = false,
  motion,
  popup = false,
  render,
  ref,
  children,
  className = "",
  style,
  ...props
}: GlassSurfaceProps & { popup?: boolean }) {
  const scene = useScene();
  const { controller } = scene;
  material ??= scene.material;
  appearance ??= scene.appearance;
  motion ??= scene.motion;
  specular ??= scene.specular;
  const relative = Boolean(concentric);
  const inset = typeof concentric === "object" ? concentric.inset : undefined;
  const options = useMemo(
    () => ({
      material,
      appearance,
      radius,
      concentric: relative ? { inset } : undefined,
      refraction,
      tint,
      specular,
      interactive,
      motion,
      popup,
    }),
    [
      material,
      appearance,
      radius,
      relative,
      inset,
      refraction,
      tint,
      specular,
      interactive,
      motion,
      popup,
    ],
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
      },
      ...(children === undefined ? {} : { children }),
    },
  });
}
