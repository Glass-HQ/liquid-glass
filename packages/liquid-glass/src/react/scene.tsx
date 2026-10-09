import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ComponentPropsWithRef, HTMLAttributes, Ref } from "react";
import { useRender } from "@base-ui/react/use-render";
import { webkit } from "../dom/filter-budget.js";
import { createGlassScene } from "../dom/index.js";
import type { GlassSceneController, GlassSceneOptions, GlassMotion } from "../dom/index.js";
import type { MaterialOptions } from "../core/materials.js";
interface SceneContextValue {
  controller: GlassSceneController;
  root: HTMLElement | null;
  maxSurfaces: number;
  material: MaterialOptions["material"];
  appearance: MaterialOptions["appearance"];
  motion: GlassMotion;
}
const inertController: GlassSceneController = {
  setContent() {},
  addForeground() { return () => {}; },
  addAnimator() { return () => {}; },
  addProgressiveBlur() { return () => {}; },
  addScrollEdges() { return () => {}; },
  addSurface() {
    return () => {};
  },
  dispose() {},
};
const SceneContext = createContext<SceneContextValue | null>(null);
/** The motion level a glass component inherits from its scene. */
export function useGlassMotion(motion?: GlassMotion): GlassMotion {
  const scene = useContext(SceneContext);
  return motion ?? scene?.motion ?? "full";
}
export function useScene() {
  const scene = useContext(SceneContext);
  if (!scene) throw new Error("Glass components must be inside <GlassScene>.");
  return scene;
}
/** Ref for live foreground DOM; registration adds no material or GPU maps. */
export function useGlassForeground() {
  const { controller } = useScene();
  return useCallback((element: HTMLElement | null) => {
    if (element) return controller.addForeground(element);
  }, [controller]);
}
export interface GlassForegroundProps extends HTMLAttributes<HTMLElement> {
  render?: Parameters<typeof useRender>[0]["render"];
  ref?: Ref<HTMLElement>;
}
/** Content above the backdrop that refracts through higher glass surfaces. */
export function GlassForeground({ render, ref, ...props }: GlassForegroundProps) {
  const attach = useGlassForeground();
  return useRender({ render, ref: [attach, ref ?? null], props });
}
export interface GlassSceneProps
  extends
    ComponentPropsWithRef<"div">,
    GlassSceneOptions,
    Pick<MaterialOptions, "material" | "appearance"> {
  /** Motion for every glass component in the scene. `full` still follows the
   * system reduced-motion setting, which removes elasticity and travel. */
  motion?: GlassMotion;
}
export function GlassScene({
  children,
  className = "",
  onDiagnostic,
  maxSurfaces = 16,
  ref,
  material = "clear",
  appearance = "light",
  motion = "full",
  ...props
}: GlassSceneProps) {
  const capacity = Math.max(1, Math.min(64, Math.floor(maxSurfaces)));
  if (!Number.isFinite(capacity))
    throw new RangeError("maxSurfaces must be finite.");
  const [scene, setScene] = useState<SceneContextValue>({
    controller: inertController,
    root: null,
    maxSurfaces: capacity,
    material,
    appearance,
    motion,
  });
  const diagnostic = useRef(onDiagnostic);
  useLayoutEffect(() => {
    diagnostic.current = onDiagnostic;
  }, [onDiagnostic]);
  const attach = useCallback(
    (root: HTMLDivElement | null) => {
      if (!root) return;
      const controller = createGlassScene(root, {
        maxSurfaces: capacity,
        onDiagnostic: (d) => diagnostic.current?.(d),
      });
      setScene((previous) => ({
        ...previous,
        controller,
        root,
        maxSurfaces: capacity,
      }));
      return () => controller.dispose();
    },
    [capacity],
  );
  return useRender({
    ref: [attach, ref ?? null],
    props: {
      ...props,
      className: `lg-scene ${className}`,
      children: (
        <SceneContext.Provider value={{ ...scene, material, appearance, motion }}>
          {children}
        </SceneContext.Provider>
      ),
    },
  });
}
export interface GlassContentProps extends ComponentPropsWithRef<"div"> {
  /** Flow determines scene height; scroll is a native scrollport filling the scene. */
  layout?: "overlay" | "flow" | "scroll";
}
const subscribeEngine = () => () => {};
const clientWebKit = () => webkit;
const serverWebKit = () => false;
export function GlassContent({
  layout = "overlay",
  className = "",
  ref,
  ...props
}: GlassContentProps) {
  const { controller } = useScene();
  const isolateScroll = useSyncExternalStore(subscribeEngine, clientWebKit, serverWebKit) && layout === "scroll";
  const attach = useCallback(
    (element: HTMLDivElement | null) => {
      controller.setContent(element);
      return () => {
        controller.setContent(null);
      };
    },
    [controller],
  );
  let rendered = useRender({
    ref: [attach, ref ?? null],
    props: { ...props, "data-layout": layout, className: `lg-content ${className}` },
  });
  // Gecko draws progressive blur on this wrapper; elsewhere it has no box.
  rendered = <div data-glass-blur-host="" data-layout={layout}>{rendered}</div>;
  // WebKit otherwise translates the entire cached reference-filter image
  // during asynchronous overflow scrolling, including stationary glass and
  // blur masks. A foreignObject keeps this live DOM scrollport and its filter
  // in the same paint pass. Input, selection and scrolling remain native.
  if (isolateScroll) rendered = <svg className="lg-scroll-paint-root" width="100%" height="100%">
    <foreignObject width="100%" height="100%">{rendered}</foreignObject>
  </svg>;
  return rendered;
}
