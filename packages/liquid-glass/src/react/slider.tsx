import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ComponentPropsWithRef, CSSProperties, KeyboardEvent, PointerEvent } from "react";
import type { Appearance, MaterialKind, Shape } from "../protocol";
// Pure value math with no imports: the thumb and fill are placed before the engine loads.
import { snapValue, valueAt, valueFraction } from "../motion/range";
import type { SliderRange } from "../motion/range";
import {
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

export interface GlassSliderProps extends Omit<
  ComponentPropsWithRef<"div">,
  "onChange" | "defaultValue" | "role" | "children"
> {
  value?: number;
  defaultValue?: number;
  /** Every change, while dragging too. */
  onValueChange?: (value: number) => void;
  /** Once a drag or key press is done. */
  onValueCommit?: (value: number) => void;
  /** Default: 0. */
  min?: number;
  /** Default: 100. */
  max?: number;
  /** Default: 1. 0 for continuous. */
  step?: number;
  /** Show a dot at every step (with a `step` above 0 and at most 40 of them). Default: false. */
  ticks?: boolean;
  disabled?: boolean;
  /** Submit in forms under this name. */
  name?: string;
  /** Text read out for a value instead of the number. */
  getValueText?: (value: number) => string;
  /** The thumb's lens material. Default: "clear". */
  material?: MaterialKind;
  /**
   * The filled part of the track, any CSS color. Default: a neutral gray (`--lg-slider-fill`).
   * The thumb stays clear glass.
   */
  tint?: string | null;
  /** Light or dark glass whatever the scene's appearance. Default: the scene's. */
  appearance?: Appearance;
  /** Highlights on the lens that follow the pointer (or device tilt). Default: the scene's. */
  specular?: boolean;
}

/**
 * A horizontal slider whose thumb follows the finger and lifts into a glass lens while held.
 * The thumb is the focusable `role="slider"`: arrows step, Page Up/Down step by a tenth of the
 * range, Home and End go to the ends.
 */
export function GlassSlider({
  value: valueProp,
  defaultValue,
  onValueChange,
  onValueCommit,
  min = 0,
  max = 100,
  step = 1,
  ticks = false,
  disabled = false,
  name,
  getValueText,
  material = "clear",
  tint,
  appearance,
  specular,
  ref,
  style,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledby,
  "aria-describedby": ariaDescribedby,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onLostPointerCapture,
  ...props
}: GlassSliderProps) {
  const scene = useGlassScene();
  const engine = useGlassEngine();
  const range: SliderRange = useMemo(() => ({ min, max, step }), [min, max, step]);
  const [value, setValue] = useControllable(
    valueProp,
    snapValue(defaultValue ?? min, range),
    onValueChange,
  );
  const shown = snapValue(value, range);
  const fraction = valueFraction(shown, range);

  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const rootRef = useMergedRef<HTMLDivElement>(setRoot, ref);
  const rail = useRef<HTMLDivElement | null>(null);
  const face = useRef<HTMLSpanElement | null>(null);
  const [thumbSize, setThumbSize] = useState({ width: 20, height: 16 });
  const {
    ref: thumbRef,
    surface,
    element: thumb,
  } = useGlassSurface({
    radius: "capsule",
    material,
    tint: null,
    appearance,
    specular,
    body: false,
    lensHeight: engine
      ? Math.ceil(thumbSize.height * (1 + 2 * engine.thumb.sliderGrow))
      : undefined,
    overhang: engine
      ? Math.ceil(
          thumbSize.width * engine.thumb.sliderGrow +
            thumbSize.width * (1 + 2 * engine.thumb.sliderGrow) * engine.thumb.stretchMax,
        ) + 1
      : undefined,
    labelsInGlass: undefined,
    bleed: undefined,
    floating: undefined,
  });
  // Null until the engine has loaded; the slider still works then, without the lens.
  const machine = useMemo(
    () => engine?.createSliderMachine({ reducedMotion: prefersReducedMotion }),
    [engine],
  );
  const pointer = useRef<number | null>(null);
  // The value the thumb is at, ahead of React: set on every change, synced from props after.
  const latest = useRef(shown);
  useLayoutEffect(() => {
    latest.current = shown;
  }, [shown]);
  const appliedFace = useRef(NaN);

  /** The rail (where the thumb's centre can go) in the slider's px, and the writing direction. */
  const track = () => {
    if (!root || !rail.current) return null;
    return { rect: rectIn(rail.current, root), rtl: getComputedStyle(root).direction === "rtl" };
  };
  const valueFrom = (x: number): number | null => {
    const t = track();
    if (!t) return null;
    const along = t.rtl ? t.rect.x + t.rect.width - x : x - t.rect.x;
    return valueAt(along, t.rect.width, range);
  };
  const change = (next: number) => {
    latest.current = next;
    setValue(next);
  };

  useSurfaceMotion(surface, "thumb", (now, dt, s) => {
    if (!machine || !engine) return { shapes: [], moving: false };
    const width = rail.current?.offsetWidth ?? 0;
    const frame = machine.advance(dt, now, valueFraction(latest.current, range) * width);
    const opacity = 1 - frame.progress;
    if (face.current && opacity !== appliedFace.current) {
      appliedFace.current = opacity;
      face.current.style.opacity = String(opacity);
    }
    if (thumb && (thumb.offsetHeight !== thumbSize.height || thumb.offsetWidth !== thumbSize.width))
      setThumbSize({ width: thumb.offsetWidth, height: thumb.offsetHeight });
    const shapes = engine.thumbShapes(s.size, frame, false, "slider");
    fitFace(face.current, s.size, shapes);
    return { shapes, moving: frame.moving };
  });

  const press = (x: number): boolean => {
    if (disabled) return false;
    const next = valueFrom(x);
    if (next === null) return false;
    // A pointer press focuses the thumb without the keyboard's focus ring.
    thumb?.focus({ preventScroll: true, focusVisible: false });
    machine?.press(performance.now());
    change(next);
    scene?.requestFrame();
    return true;
  };
  const drag = (x: number) => {
    const next = valueFrom(x);
    if (next !== null) change(next);
    scene?.requestFrame();
  };
  const release = () => {
    machine?.release(performance.now());
    onValueCommit?.(latest.current);
    scene?.requestFrame();
  };

  const padded = useDragPad(
    scene,
    root,
    { down: (point) => press(point.x), move: (point) => drag(point.x), up: () => release() },
    !disabled,
  );

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || event.defaultPrevented) return;
    const rtl = root ? getComputedStyle(root).direction === "rtl" : false;
    const unit = step > 0 ? step : (max - min) / 100;
    const page = Math.max(unit, (max - min) / 10);
    let next: number;
    switch (event.key) {
      case "ArrowRight":
        next = shown + (rtl ? -unit : unit);
        break;
      case "ArrowLeft":
        next = shown + (rtl ? unit : -unit);
        break;
      case "ArrowUp":
        next = shown + unit;
        break;
      case "ArrowDown":
        next = shown - unit;
        break;
      case "PageUp":
        next = shown + page;
        break;
      case "PageDown":
        next = shown - page;
        break;
      case "Home":
        next = min;
        break;
      case "End":
        next = max;
        break;
      default:
        return;
    }
    event.preventDefault();
    const snapped = snapValue(next, range);
    change(snapped);
    onValueCommit?.(snapped);
  };

  return (
    <div
      {...props}
      ref={rootRef}
      style={
        {
          ...style,
          "--lg-slider-fraction": fraction,
          ...(tint ? { "--lg-slider-fill": tint } : {}),
        } as CSSProperties
      }
      data-lg-slider=""
      data-disabled={disabled || undefined}
      onPointerDown={chain((event: PointerEvent<HTMLDivElement>) => {
        if (event.defaultPrevented || event.button !== 0 || pointer.current !== null || !root)
          return;
        // Touches on iOS go to the 120 Hz pad laid over the slider.
        if (padded && event.pointerType === "touch") return;
        if (!press(pointIn(event, root).x)) return;
        pointer.current = event.pointerId;
        root.setPointerCapture(event.pointerId);
        // Keep focus on the thumb, and no text selection while dragging.
        event.preventDefault();
      }, onPointerDown)}
      onPointerMove={chain((event: PointerEvent<HTMLDivElement>) => {
        if (event.pointerId === pointer.current && root) drag(pointIn(event, root).x);
      }, onPointerMove)}
      onPointerUp={chain((event: PointerEvent<HTMLDivElement>) => {
        if (event.pointerId !== pointer.current) return;
        pointer.current = null;
        release();
      }, onPointerUp)}
      onPointerCancel={chain((event: PointerEvent<HTMLDivElement>) => {
        if (event.pointerId !== pointer.current) return;
        pointer.current = null;
        release();
      }, onPointerCancel)}
      onLostPointerCapture={chain((event: PointerEvent<HTMLDivElement>) => {
        if (event.pointerId !== pointer.current) return;
        pointer.current = null;
        release();
      }, onLostPointerCapture)}
    >
      <div data-lg-slider-track="">
        <div data-lg-slider-fill="" style={{ width: `${fraction * 100}%` }} />
      </div>
      {ticks && step > 0 && (max - min) / step <= 40 && (
        <div data-lg-slider-ticks="" aria-hidden="true">
          {Array.from({ length: Math.round((max - min) / step) + 1 }, (_, index) => (
            <span key={index} />
          ))}
        </div>
      )}
      <div ref={rail} data-lg-slider-rail="">
        <div
          ref={thumbRef}
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={shown}
          aria-valuetext={getValueText?.(shown)}
          aria-orientation="horizontal"
          aria-disabled={disabled || undefined}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledby}
          aria-describedby={ariaDescribedby}
          data-lg-slider-thumb=""
          style={{ insetInlineStart: `${fraction * 100}%` }}
          onKeyDown={keyDown}
        >
          <span ref={face} data-lg-thumb-face="" data-lg-ignore="" />
        </div>
      </div>
      {name !== undefined && <input type="hidden" name={name} value={shown} disabled={disabled} />}
    </div>
  );
}

/**
 * The knob grows with the lens while it fades, as the library's thumbs always did, so a small
 * knob never shows inside a bigger lens.
 */
function fitFace(
  face: HTMLElement | null,
  size: { width: number; height: number },
  shapes: Shape[],
) {
  if (!face) return;
  const rect = shapes[0]?.rect;
  const inset = rect
    ? `${rect.y}px ${size.width - rect.x - rect.width}px ${size.height - rect.y - rect.height}px ${rect.x}px`
    : "0px";
  if (face.style.inset !== inset) face.style.inset = inset;
}
