import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { Ref, RefCallback } from "react";
import type { Appearance, Rect, Shape } from "../protocol";
import type { GlassScene, GlassSurfaceHandle, GlassTone, SurfaceOptions } from "../scene/scene";
import type { DragPadHandlers } from "../scene/ios/drag-pad";
import type { TelemetryReport } from "../scene/telemetry";
// Types only: the engine is loaded on demand by `<GlassScene>`, never with the React entry.
import type * as EngineModule from "./engine";

export type Engine = typeof EngineModule;

export interface SceneContextValue {
  /** Null until the engine has loaded. */
  readonly scene: GlassScene | null;
  /** The loaded engine, set together with `scene`. */
  readonly engine: Engine | null;
  /**
   * The scene's appearance once the engine failed to load, else null. Surfaces then fall back
   * to CSS, as they do when the renderer fails.
   */
  readonly failed: Appearance | null;
  /** The scene's root element, where popups render over the page. */
  readonly root: HTMLElement | null;
}

export const SceneContext = createContext<SceneContextValue | null>(null);
export const SurfaceContext = createContext<GlassSurfaceHandle | null>(null);

/**
 * Glass inside a `GlassGroup` is drawn by the group: every member's shapes go into the group's
 * one surface, so neighbouring pieces melt into each other as they near (smooth-min).
 */
export interface GroupJoin {
  join(element: HTMLElement, options: SurfaceOptions): GlassSurfaceHandle;
}

export const GroupContext = createContext<GroupJoin | null>(null);

/**
 * How much each glass button has grown under a press right now (1 at rest), so glass that takes
 * over from it (a menu's morph) starts at the size it shows.
 */
export const pressGrowth = new WeakMap<Element, number>();

let motionQuery: MediaQueryList | null = null;

/** Whether the person asked for reduced motion; read when motion starts, so it follows changes. */
export const prefersReducedMotion = (): boolean =>
  (motionQuery ??= matchMedia("(prefers-reduced-motion: reduce)")).matches;

/** The nearest `<GlassScene>`'s scene, or null before it has mounted (and outside one). */
export const useGlassScene = (): GlassScene | null => useContext(SceneContext)?.scene ?? null;

/** The loaded engine (motion machines and helpers), or null before it has loaded. */
export const useGlassEngine = (): Engine | null => useContext(SceneContext)?.engine ?? null;

/** The surface this component is inside, or null. */
export const useGlassSurfaceContext = (): GlassSurfaceHandle | null => useContext(SurfaceContext);

/**
 * The scene's latest telemetry report, refreshed at the scene's report interval. Null until the
 * first report; reports only come while the scene's `telemetry` is on.
 */
export function useGlassTelemetry(): TelemetryReport | null {
  const scene = useGlassScene();
  const [report, setReport] = useState<TelemetryReport | null>(null);
  useEffect(() => scene?.telemetry.subscribe(setReport), [scene]);
  return report;
}

/** Make `element` a glass surface of the nearest scene while both exist. */
export function useGlassSurface(options: SurfaceOptions): {
  ref: RefCallback<HTMLElement>;
  element: HTMLElement | null;
  surface: GlassSurfaceHandle | null;
} {
  const context = useContext(SceneContext);
  const scene = context?.scene ?? null;
  const failed = context?.failed ?? null;
  // Inside a `GlassGroup`, the group draws this glass: it joins the group instead of the scene.
  const group = useContext(GroupContext);
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [surface, setSurface] = useState<GlassSurfaceHandle | null>(null);
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });

  useLayoutEffect(() => {
    if (!element) return;
    if (!group && !scene) return;
    const handle = group
      ? group.join(element, latest.current)
      : (scene as GlassScene).addSurface(element, latest.current);
    setSurface(handle);
    return () => {
      handle.remove();
      setSurface(null);
    };
  }, [scene, element, group]);

  const {
    radius,
    smoothing,
    material,
    tint,
    labelsInGlass,
    bleed,
    body,
    overhang,
    lensHeight,
    floating,
    appearance,
    adaptive,
    edge,
    specular,
  } = options;

  // Without an engine there is no scene to mark the fallback, so mark it here.
  useLayoutEffect(() => {
    if (!failed || !element) return;
    element.setAttribute("data-lg-fallback", "");
    element.setAttribute("data-lg-appearance", appearance ?? failed);
    return () => {
      element.removeAttribute("data-lg-fallback");
      element.removeAttribute("data-lg-appearance");
    };
  }, [failed, element, appearance]);

  const radiusKey = Array.isArray(radius) ? radius.join(",") : radius;
  useLayoutEffect(() => {
    surface?.update(latest.current);
    // `radiusKey` stands in for `radius`, which may be a fresh array every render.
  }, [
    surface,
    radiusKey,
    smoothing,
    material,
    tint,
    labelsInGlass,
    bleed,
    body,
    overhang,
    lensHeight,
    floating,
    appearance,
    adaptive,
    edge,
    specular,
  ]);

  const ref = useCallback((node: HTMLElement | null) => setElement(node), []);
  return { ref, element, surface };
}

/**
 * The tone of the surface this component is inside (or of `surface`): "dark" glass wants light
 * labels, "light" glass dark ones. It follows what is behind small glass. Null outside a surface and before the engine has loaded.
 */
export function useGlassTone(surface?: GlassSurfaceHandle | null): GlassTone | null {
  const context = useContext(SurfaceContext);
  const target = surface === undefined ? context : surface;
  const [tone, setTone] = useState<GlassTone | null>(target?.tone ?? null);
  useEffect(() => {
    setTone(target?.tone ?? null);
    return target?.onTone(setTone);
  }, [target]);
  return tone;
}

/** Several refs as one, keeping React 19 ref cleanups working. */
export function useMergedRef<T>(...refs: (Ref<T> | undefined)[]): RefCallback<T> {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback(mergeRefs(...refs), refs);
}

export function mergeRefs<T>(...refs: (Ref<T> | undefined)[]): RefCallback<T> {
  return (node: T | null) => {
    const cleanups: (() => void)[] = [];
    for (const ref of refs) {
      if (typeof ref === "function") {
        const cleanup = ref(node);
        cleanups.push(typeof cleanup === "function" ? cleanup : () => ref(null));
      } else if (ref) {
        (ref as { current: T | null }).current = node;
        cleanups.push(() => {
          (ref as { current: T | null }).current = null;
        });
      }
    }
    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  };
}

/** A value that is either controlled by props or kept here, with one change callback. */
export function useControllable<T>(
  value: T | undefined,
  defaultValue: T,
  onChange: ((value: T) => void) | undefined,
): [T, (next: T) => void] {
  const [own, setOwn] = useState(defaultValue);
  const controlled = value !== undefined;
  const current = controlled ? value : own;
  // The latest value, so two changes in one event compare against the first, not a stale render.
  const latest = useRef(current);
  const change = useRef(onChange);
  useLayoutEffect(() => {
    latest.current = current;
    change.current = onChange;
  });
  const set = useCallback(
    (next: T) => {
      if (Object.is(next, latest.current)) return;
      latest.current = next;
      if (!controlled) setOwn(next);
      change.current?.(next);
    },
    [controlled],
  );
  return [current, set];
}

/**
 * Drive a surface's shapes from a motion machine every frame. `step` returns the shapes for this
 * frame and whether it is still moving; shapes are only re-sent when they change.
 */
export function useSurfaceMotion(
  surface: GlassSurfaceHandle | null,
  layer: string,
  step: (
    now: number,
    dt: number,
    surface: GlassSurfaceHandle,
  ) => { shapes: Shape[]; moving: boolean },
): void {
  const context = useContext(SceneContext);
  const scene = context?.scene ?? null;
  const engine = context?.engine ?? null;
  const latest = useRef(step);
  useLayoutEffect(() => {
    latest.current = step;
  });
  useLayoutEffect(() => {
    if (!scene || !engine || !surface) return;
    const { sameShapes } = engine;
    let last: Shape[] = [];
    const stop = scene.animate((now, dt) => {
      const { shapes, moving } = latest.current(now, dt, surface);
      if (!sameShapes(shapes, last)) {
        last = shapes;
        surface.setShapes(shapes, layer);
      }
      return moving;
    });
    return () => {
      stop();
      surface.setShapes([], layer);
    };
  }, [scene, engine, surface, layer]);
}

/** An element's border box in another element's px (before either's transforms). */
export function rectIn(element: Element, container: HTMLElement): Rect {
  const a = element.getBoundingClientRect();
  const b = container.getBoundingClientRect();
  const sx = container.offsetWidth / (b.width || 1);
  const sy = container.offsetHeight / (b.height || 1);
  return {
    x: (a.left - b.left) * sx,
    y: (a.top - b.top) * sy,
    width: a.width * sx,
    height: a.height * sy,
  };
}

/** A pointer event's position in an element's px (before its transforms). */
export function pointIn(
  event: { clientX: number; clientY: number },
  element: HTMLElement,
): { x: number; y: number } {
  const rect = element.getBoundingClientRect();
  const sx = element.offsetWidth / (rect.width || 1);
  const sy = element.offsetHeight / (rect.height || 1);
  return { x: (event.clientX - rect.left) * sx, y: (event.clientY - rect.top) * sy };
}

/** Call both handlers: the component's own and the one passed in props. */
export function chain<E>(
  own: (event: E) => void,
  theirs: ((event: E) => void) | undefined,
): (event: E) => void {
  return (event) => {
    theirs?.(event);
    own(event);
  };
}

/**
 * On iOS, lay a 120 Hz controller (an invisible endless scroller) over `element` for touches.
 * Mouse and pen input still reaches the element's own pointer handlers. Returns whether a pad
 * is in place, so touch pointer events can be left to it.
 */
export function useDragPad(
  scene: GlassScene | null,
  element: HTMLElement | null,
  handlers: DragPadHandlers,
  enabled = true,
): boolean {
  const latest = useRef(handlers);
  useLayoutEffect(() => {
    latest.current = handlers;
  });
  const [active, setActive] = useState(false);
  useLayoutEffect(() => {
    if (!scene || !element || !enabled) return;
    const pad = scene.createDragPad(element, {
      down: (point) => latest.current.down(point),
      move: (point) => latest.current.move(point),
      up: (commit) => latest.current.up(commit),
    });
    if (!pad) return;
    element.setAttribute("data-lg-padded", "");
    setActive(true);
    return () => {
      pad.destroy();
      element.removeAttribute("data-lg-padded");
      setActive(false);
    };
  }, [scene, element, enabled]);
  return active;
}
