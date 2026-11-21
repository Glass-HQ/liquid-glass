import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, HTMLAttributes, Ref } from "react";
import { useRender } from "@base-ui/react/use-render";
import { shapeContainerAttributes } from "../dom/shape-layout.js";
import type { GlassMotion } from "../dom/index.js";
import type { MaterialOptions } from "../core/materials.js";
import { useScene } from "./scene.js";
/** How a glass surface moves. Every option is available to any surface. */
export interface GlassMotionProps {
  /** Respond to touch and pointer input as macOS glass does: grow 2.5 points
   * under a press, light up beneath the pointer, and settle back on release. */
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
/** A popup that is closing stays on screen while the popup opening in its
 * place waits for its glass, so moving from one submenu to the next never
 * leaves a gap. Base UI keeps a closing popup until its animations finish; a
 * still animation holds it until no popup in the scene is waiting, checked
 * over two frames so a popup mounting a frame late counts, and for at most
 * 400ms. */
function holdForNextPopup(element: HTMLElement, root: HTMLElement | null) {
  let animation: Animation | undefined;
  let frame = 0;
  const view = element.ownerDocument.defaultView ?? window;
  const observer = new MutationObserver(() => {
    if (animation || !element.hasAttribute("data-ending-style")) return;
    animation = element.animate([{ opacity: 1 }, { opacity: 1 }], { duration: 400 });
    let quiet = 0;
    const check = () => {
      const waiting = (root ?? element.ownerDocument).querySelector("[data-glass-pending]");
      quiet = waiting ? 0 : quiet + 1;
      if (quiet >= 2) animation?.finish();
      else frame = view.requestAnimationFrame(check);
    };
    frame = view.requestAnimationFrame(check);
  });
  observer.observe(element, { attributes: true, attributeFilter: ["data-ending-style"] });
  return () => {
    observer.disconnect();
    view.cancelAnimationFrame(frame);
  };
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
  frost,
  floating,
  aberration,
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
  frost ??= scene.frost;
  // Popups float above the window, like a menu or popover.
  floating ??= popup;
  const relative = Boolean(concentric);
  const inset = typeof concentric === "object" ? concentric.inset : undefined;
  // How the glass looks changes in place; what it is (its shape, motion and
  // role) registers it again. A change of material then never moves the
  // surface or anything anchored to it.
  const look = { material, appearance, refraction, tint, frost, floating, aberration };
  const lookRef = useRef(look);
  lookRef.current = look;
  const structure = useMemo(
    () => ({
      radius,
      concentric: relative ? { inset } : undefined,
      specular,
      interactive,
      motion,
      popup,
    }),
    [radius, relative, inset, specular, interactive, motion, popup],
  );
  const [element, setElement] = useState<HTMLElement | null>(null);
  const attach = useCallback(
    (node: HTMLElement | null) => {
      if (!node) return;
      const remove = controller.addSurface(node, { ...structure, ...lookRef.current });
      const release = popup ? holdForNextPopup(node, scene.root) : undefined;
      setElement(node);
      return () => {
        release?.();
        remove();
        setElement(null);
      };
    },
    [controller, structure, popup, scene.root],
  );
  useLayoutEffect(() => {
    if (element) controller.updateSurface(element, look);
    // The look's fields, not the object, decide whether it changed.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [controller, element, material, appearance, refraction, tint, frost, floating, aberration]);
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
