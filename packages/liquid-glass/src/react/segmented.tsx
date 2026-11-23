import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ComponentPropsWithRef, KeyboardEvent, MouseEvent, PointerEvent } from "react";
import type { Appearance, MaterialKind, Rect } from "../protocol";
import type { RadiusSpec } from "../core/geometry";
import type { LensLayout, LensMachine } from "../motion/lens";
import {
  SurfaceContext,
  chain,
  pointIn,
  prefersReducedMotion,
  rectIn,
  useControllable,
  useDragPad,
  useGlassEngine,
  useGlassScene,
  useGlassSurface,
  useMergedRef,
  useSurfaceMotion,
} from "./hooks";

interface SegmentedContext {
  readonly value: string | null;
  readonly kind: "tabs" | "radio";
  readonly disabled: boolean;
  readonly select: (value: string) => void;
  /** True (once) right after a pointer gesture chose a segment: the click that follows is ignored. */
  readonly consumeClick: () => boolean;
}

const Context = createContext<SegmentedContext | null>(null);

export interface GlassSegmentedProps extends Omit<
  ComponentPropsWithRef<"div">,
  "onChange" | "defaultValue" | "role"
> {
  value?: string | null;
  defaultValue?: string | null;
  onValueChange?: (value: string) => void;
  /** Tabs (`tablist`/`tab`) or a choice (`radiogroup`/`radio`). Default: "tabs". */
  kind?: "tabs" | "radio";
  disabled?: boolean;
  /**
   * Highlights along the rim that follow the pointer, or the device's tilt where the browser
   * reports it. Default: the scene's.
   */
  specular?: boolean;
  material?: MaterialKind;
  tint?: string | null;
  /** The bar's corners. Default: "capsule". */
  radius?: RadiusSpec;
  /** The pill's corners. Default: the bar's less the pill's inset, concentric with the bar. */
  segmentRadius?: RadiusSpec;
  /** Draw the labels in the glass so the lens magnifies them. Default: true. */
  labelsInGlass?: boolean;
  bleed?: number;
  /**
   * The bar floats above the content (a tab bar over a scrolling page): it frosts like a panel,
   * so its labels stay legible over anything, and casts a floating shadow. Default: false.
   */
  floating?: boolean;
  /** Light or dark glass whatever the scene's appearance. Default: the scene's. */
  appearance?: Appearance;
  /** With `kind="radio"`, submit the value in forms under this name. */
  name?: string;
}

const segmentSelector = "[data-lg-segment]";

// Here rather than from core/, which the React entry loads only with the engine.
const contains = (r: Rect, x: number, y: number): boolean =>
  x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;

/**
 * A segmented control or tab bar. The selected segment sits on a glass pill; pressing lifts it
 * into a magnifying lens that can be dragged between segments, stretching the bar at its ends,
 * and settles on the nearest segment. Keyboard: arrows, Home and End move and select.
 */
export function GlassSegmented({
  value: valueProp,
  defaultValue = null,
  onValueChange,
  kind = "tabs",
  disabled = false,
  specular,
  material,
  tint,
  radius = "capsule",
  segmentRadius,
  labelsInGlass = true,
  bleed,
  floating = false,
  appearance,
  name,
  ref,
  children,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onLostPointerCapture,
  onKeyDown,
  ...props
}: GlassSegmentedProps) {
  const scene = useGlassScene();
  const engine = useGlassEngine();
  const [value, setValue] = useControllable<string | null>(valueProp, defaultValue, (next) => {
    if (next !== null) onValueChange?.(next);
  });
  const [lensHeight, setLensHeight] = useState(0);
  const [overhang, setOverhang] = useState(0);
  const {
    ref: surfaceRef,
    surface,
    element: bar,
  } = useGlassSurface({
    specular,
    radius,
    material,
    tint,
    labelsInGlass,
    bleed,
    lensHeight,
    overhang,
    body: true,
    floating,
    appearance,
  });
  const mergedRef = useMergedRef<HTMLDivElement>(surfaceRef, ref);
  const machineRef = useRef<LensMachine | null>(null);
  const layoutRef = useRef<{ layout: LensLayout; values: string[] } | null>(null);
  const pointer = useRef<number | null>(null);
  const clickHandled = useRef(false);
  const valueRef = useRef(value);
  useLayoutEffect(() => {
    valueRef.current = value;
  }, [value]);

  const measure = useCallback((): { layout: LensLayout; values: string[] } | null => {
    if (!bar) return null;
    const items = [...bar.querySelectorAll<HTMLButtonElement>(segmentSelector)].filter(
      (item) => item.closest("[data-lg-segmented]") === bar,
    );
    const measured = {
      layout: {
        bar: { x: 0, y: 0, width: bar.offsetWidth, height: bar.offsetHeight },
        segments: items.map((item) => rectIn(item, bar)),
        disabled: items.map((item) => item.disabled),
        dpr: window.devicePixelRatio || 1,
      },
      values: items.map((item) => item.dataset.value ?? ""),
    };
    layoutRef.current = measured;
    return measured;
  }, [bar]);

  /** Re-measure and hand the machine its layout, creating it once the engine has loaded. */
  const relayout = useCallback(() => {
    const measured = measure();
    if (!measured || !engine) return null;
    const index = Math.max(0, measured.values.indexOf(valueRef.current ?? ""));
    if (!machineRef.current)
      machineRef.current = engine.createLensMachine(measured.layout, index, {
        reducedMotion: prefersReducedMotion,
        profile: floating ? "tabBar" : "segmented",
      });
    else machineRef.current.layout(measured.layout);
    const pill = Math.max(0, ...measured.layout.segments.map((s) => s.height));
    const barHeight = measured.layout.bar.height;
    if (floating) {
      // Room for the tab bar's lens: 1.5 times the pill, up to a third taller again when it
      // squashes, and the bar's pull.
      const lens = pill * 1.5;
      setLensHeight(Math.ceil(lens));
      setOverhang(Math.ceil(Math.max(0, (lens * 1.34 - barHeight) / 2) + engine.stretch.limit));
    } else {
      // The segmented control's lens: 1.58 times the pill, 1.072 times that at its wobble.
      const lens = pill * 1.58;
      setLensHeight(Math.ceil(lens));
      setOverhang(Math.ceil(Math.max(0, (lens * 1.072 - barHeight) / 2, pill / 3) + 2));
    }
    scene?.requestFrame();
    return machineRef.current;
  }, [measure, scene, engine, floating]);

  // Layout: on mount, on resize of the bar or any segment, and when segments come and go.
  useLayoutEffect(() => {
    if (!bar) return;
    relayout();
    const resize = new ResizeObserver(() => relayout());
    const observeAll = () => {
      resize.disconnect();
      resize.observe(bar);
      for (const item of bar.querySelectorAll(segmentSelector)) resize.observe(item);
    };
    observeAll();
    const mutations = new MutationObserver(() => {
      observeAll();
      relayout();
    });
    mutations.observe(bar, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["disabled", "data-value"],
    });
    return () => {
      resize.disconnect();
      mutations.disconnect();
    };
  }, [bar, relayout]);

  // The selection from outside (a click, the keyboard, a controlled value).
  useLayoutEffect(() => {
    const machine = machineRef.current;
    const values = layoutRef.current?.values;
    if (!machine || !values) return;
    const index = values.indexOf(value ?? "");
    if (index >= 0 && index !== machine.selected) {
      machine.select(index);
      scene?.requestFrame();
    }
  }, [value, scene]);

  useSurfaceMotion(surface, "lens", (now, dt) => {
    const machine = machineRef.current;
    const layout = layoutRef.current?.layout;
    if (!machine || !layout || !engine) return { shapes: [], moving: false };
    const frame = machine.advance(dt, now);
    return {
      shapes: engine.lensShapes(frame, {
        bar: radius,
        segment: segmentRadius ?? null,
        restBar: layout.bar,
      }),
      moving: frame.moving,
    };
  });

  const commitIndex = (index: number) => {
    const next = layoutRef.current?.values[index];
    if (next !== undefined) setValue(next);
  };

  /** The segment under a point, or the nearest one along the bar; null for a disabled one. */
  const segmentAt = (point: { x: number; y: number }): number | null => {
    const layout = layoutRef.current?.layout;
    if (!layout || layout.segments.length === 0) return null;
    let index = layout.segments.findIndex((r) =>
      contains({ ...r, y: 0, height: layout.bar.height }, point.x, point.y),
    );
    if (index < 0) {
      let best = Infinity;
      layout.segments.forEach((r, i) => {
        const d = Math.abs(r.x + r.width / 2 - point.x);
        if (d < best) {
          best = d;
          index = i;
        }
      });
    }
    return layout.disabled?.[index] ? null : index;
  };

  const press = (point: { x: number; y: number }): boolean => {
    if (disabled) return false;
    const machine = relayout();
    const index = segmentAt(point);
    if (!machine || index === null) return false;
    machine.press(index, point);
    scene?.requestFrame();
    return true;
  };
  const move = (point: { x: number; y: number }) => {
    machineRef.current?.move(point);
    scene?.requestFrame();
  };
  const release = (commit: boolean) => {
    const machine = machineRef.current;
    if (!machine) return;
    const index = machine.release(commit);
    if (commit) {
      commitIndex(index);
      clickHandled.current = true;
      // If no click follows (the finger left the segment), forget it.
      setTimeout(() => {
        clickHandled.current = false;
      }, 0);
    }
    scene?.requestFrame();
  };

  const padded = useDragPad(scene, bar, { down: press, move, up: release }, !disabled);

  const select = useCallback((next: string) => setValue(next), [setValue]);
  const consumeClick = useCallback(() => {
    const handled = clickHandled.current;
    clickHandled.current = false;
    return handled;
  }, []);
  const context = useMemo<SegmentedContext>(
    () => ({ value, kind, disabled, select, consumeClick }),
    [value, kind, disabled, select, consumeClick],
  );

  // Roving focus: with no segment selected, the first enabled one takes the tab stop.
  useLayoutEffect(() => {
    if (!bar) return;
    const items = [...bar.querySelectorAll<HTMLButtonElement>(segmentSelector)];
    if (items.some((item) => item.tabIndex === 0)) return;
    const first = items.find((item) => !item.disabled);
    if (first) first.tabIndex = 0;
  });

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || !bar) return;
    const items = [...bar.querySelectorAll<HTMLButtonElement>(segmentSelector)].filter(
      (item) => !item.disabled && item.closest("[data-lg-segmented]") === bar,
    );
    const current = items.findIndex((item) => item === document.activeElement);
    if (current < 0) return;
    const rtl = getComputedStyle(bar).direction === "rtl";
    let next: number;
    switch (event.key) {
      case "ArrowRight":
        next = current + (rtl ? -1 : 1);
        break;
      case "ArrowLeft":
        next = current + (rtl ? 1 : -1);
        break;
      case "ArrowDown":
        next = current + 1;
        break;
      case "ArrowUp":
        next = current - 1;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = items.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const target = items[(next + items.length) % items.length];
    if (!target) return;
    target.focus();
    const nextValue = target.dataset.value;
    if (nextValue !== undefined) setValue(nextValue);
  };

  return (
    <>
      <div
        {...props}
        ref={mergedRef}
        role={kind === "radio" ? "radiogroup" : "tablist"}
        aria-orientation="horizontal"
        aria-disabled={disabled || undefined}
        data-lg-segmented=""
        onKeyDown={chain(keyDown, onKeyDown)}
        onPointerDown={chain((event: PointerEvent<HTMLDivElement>) => {
          // Touches on iOS go to the 120 Hz pad laid over the bar.
          if (event.defaultPrevented || event.button !== 0 || pointer.current !== null || !bar)
            return;
          if (padded && event.pointerType === "touch") return;
          if (!press(pointIn(event, bar))) return;
          pointer.current = event.pointerId;
          bar.setPointerCapture(event.pointerId);
        }, onPointerDown)}
        onPointerMove={chain((event: PointerEvent<HTMLDivElement>) => {
          if (event.pointerId === pointer.current && bar) move(pointIn(event, bar));
        }, onPointerMove)}
        onPointerUp={chain((event: PointerEvent<HTMLDivElement>) => {
          if (event.pointerId !== pointer.current) return;
          pointer.current = null;
          release(true);
        }, onPointerUp)}
        onPointerCancel={chain((event: PointerEvent<HTMLDivElement>) => {
          if (event.pointerId !== pointer.current) return;
          pointer.current = null;
          release(false);
        }, onPointerCancel)}
        onLostPointerCapture={chain((event: PointerEvent<HTMLDivElement>) => {
          if (event.pointerId !== pointer.current) return;
          pointer.current = null;
          release(false);
        }, onLostPointerCapture)}
      >
        <SurfaceContext value={surface}>
          <Context value={context}>{children}</Context>
        </SurfaceContext>
      </div>
      {kind === "radio" && name !== undefined && (
        <input type="hidden" name={name} value={value ?? ""} />
      )}
    </>
  );
}

export interface GlassSegmentedItemProps extends Omit<
  ComponentPropsWithRef<"button">,
  "value" | "role"
> {
  value: string;
}

/** One segment: a real button, a `tab` or a `radio` by the control's kind. */
export function GlassSegmentedItem({
  value,
  disabled,
  onClick,
  children,
  ...props
}: GlassSegmentedItemProps) {
  const context = useContext(Context);
  if (!context) throw new Error("GlassSegmentedItem must be inside a GlassSegmented.");
  const selected = context.value === value;
  const off = disabled || context.disabled;
  return (
    <button
      {...props}
      type="button"
      role={context.kind === "radio" ? "radio" : "tab"}
      aria-selected={context.kind === "tabs" ? selected : undefined}
      aria-checked={context.kind === "radio" ? selected : undefined}
      tabIndex={selected ? 0 : -1}
      disabled={off}
      data-lg-segment=""
      data-value={value}
      data-selected={selected || undefined}
      onClick={chain((event: MouseEvent<HTMLButtonElement>) => {
        // A pointer press already chose through the lens; keyboard and assistive clicks land here.
        if (context.consumeClick()) return;
        if (!event.defaultPrevented) context.select(value);
      }, onClick)}
    >
      {children}
    </button>
  );
}
