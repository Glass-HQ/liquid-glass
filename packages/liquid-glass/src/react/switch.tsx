import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  ComponentPropsWithRef,
  KeyboardEvent,
  MouseEvent,
  PointerEvent,
} from "react";
import type { Appearance, MaterialKind, Shape } from "../protocol";
import type { SwitchMachine } from "../motion/switch";
import {
  chain,
  pointIn,
  prefersReducedMotion,
  useControllable,
  useDragPad,
  useGlassEngine,
  useGlassScene,
  useGlassSurface,
  useMergedRef,
  useSurfaceMotion,
} from "./hooks";

export interface GlassSwitchProps extends Omit<
  ComponentPropsWithRef<"button">,
  "onChange" | "value" | "defaultChecked" | "role"
> {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** The thumb's lens material. Default: "clear". */
  material?: MaterialKind;
  /**
   * The track's color while on, any CSS color. Default: a neutral gray (`--lg-switch-on`). The
   * thumb stays clear glass.
   */
  tint?: string | null;
  /** Light or dark glass whatever the scene's appearance. Default: the scene's. */
  appearance?: Appearance;
  /** Highlights on the lens that follow the pointer (or device tilt). Default: the scene's. */
  specular?: boolean;
  /** Submit in forms under this name while on. */
  name?: string;
  /** The value submitted while on. Default: "on". */
  value?: string;
}

/**
 * An on/off switch. The thumb springs between sides and lifts into a glass lens while
 * held; it can be dragged across.
 */
export function GlassSwitch({
  checked: checkedProp,
  defaultChecked = false,
  onCheckedChange,
  material = "clear",
  tint,
  appearance,
  specular,
  name,
  value = "on",
  disabled,
  ref,
  onClick,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onLostPointerCapture,
  onKeyDown,
  onKeyUp,
  onBlur,
  ...props
}: GlassSwitchProps) {
  const scene = useGlassScene();
  const engine = useGlassEngine();
  const [checked, setChecked] = useControllable(checkedProp, defaultChecked, onCheckedChange);
  const [root, setRoot] = useState<HTMLButtonElement | null>(null);
  const rootRef = useMergedRef<HTMLButtonElement>(setRoot, ref);
  const [thumbHeight, setThumbHeight] = useState(20);
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
    lensHeight: engine ? Math.ceil(thumbHeight * (1 + 2 * engine.thumb.growY)) : undefined,
    overhang: engine
      ? Math.ceil(thumbHeight * engine.thumb.growX * (1 + engine.thumb.stretchMax))
      : undefined,
    labelsInGlass: undefined,
    bleed: undefined,
    floating: undefined,
  });
  const face = useRef<HTMLSpanElement | null>(null);
  const machine: SwitchMachine | null = useMemo(
    () => engine?.createSwitchMachine(checked, { reducedMotion: prefersReducedMotion }) ?? null,
    // One machine per engine (the switch's life); `checked` changes are sent below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine],
  );
  const pointer = useRef<number | null>(null);
  const clickHandled = useRef(false);
  const applied = useRef({ offset: NaN, face: NaN, on: checked, lit: 0 });

  // Thumb travel from the switch's own layout (its CSS sizes), in either writing direction.
  const measure = () => {
    if (!root || !thumb) return null;
    const inset = Math.min(
      thumb.offsetLeft,
      root.clientWidth - thumb.offsetLeft - thumb.offsetWidth,
    );
    return {
      width: root.offsetWidth,
      travel: Math.max(0, root.clientWidth - thumb.offsetWidth - inset * 2),
      rtl: getComputedStyle(root).direction === "rtl",
    };
  };
  const layout = () => {
    const measured = measure();
    if (!measured || !thumb) return;
    machine?.layout(measured);
    if (thumb.offsetHeight !== thumbHeight) setThumbHeight(thumb.offsetHeight);
  };
  useLayoutEffect(() => {
    if (!root || !thumb) return;
    layout();
    const resize = new ResizeObserver(() => {
      layout();
      scene?.requestFrame();
    });
    resize.observe(root);
    return () => resize.disconnect();
    // `layout` reads only refs and stable values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, thumb, scene, machine]);

  // Until the engine (and the machine) arrives, the thumb still sits on its side.
  useLayoutEffect(() => {
    if (machine || !thumb) return;
    const measured = measure();
    const offset = checked && measured ? measured.travel * (measured.rtl ? -1 : 1) : 0;
    thumb.style.translate = offset ? `${offset}px 0` : "";
    // `measure` reads only refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machine, thumb, root, checked]);

  useLayoutEffect(() => {
    if (!machine) return;
    machine.setChecked(checked);
    scene?.requestFrame();
  }, [checked, machine, scene]);

  useSurfaceMotion(surface, "thumb", (now, dt, s) => {
    if (!machine || !engine) return { shapes: [], moving: false };
    const frame = machine.advance(dt, now);
    // The thumb and its face are real DOM: move them here, before the scene measures.
    if (thumb && frame.offset !== applied.current.offset) {
      applied.current.offset = frame.offset;
      thumb.style.translate = `${frame.offset}px 0`;
    }
    const faceOpacity = 1 - frame.progress;
    if (face.current && faceOpacity !== applied.current.face) {
      applied.current.face = faceOpacity;
      face.current.style.opacity = String(faceOpacity);
    }
    // The track brightens by a tenth while the thumb is held.
    const lit = Math.round(frame.progress * 100) / 100;
    if (root && lit !== applied.current.lit) {
      applied.current.lit = lit;
      root.style.setProperty("--lg-switch-held", String(lit));
    }
    if (root && frame.on !== applied.current.on) {
      applied.current.on = frame.on;
      root.toggleAttribute("data-lg-on", frame.on);
    }
    const shapes = engine.thumbShapes(s.size, frame);
    fitFace(face.current, s.size, shapes);
    return { shapes, moving: frame.moving };
  });

  const press = (x: number) => {
    if (disabled || !machine) return false;
    layout();
    machine.press(x, performance.now());
    scene?.requestFrame();
    return true;
  };
  const drag = (x: number) => {
    machine?.drag(x);
    scene?.requestFrame();
  };
  const release = (commit: boolean) => {
    if (!machine) return;
    const result = machine.release(commit, performance.now());
    if (result !== null) setChecked(result);
    clickHandled.current = true;
    setTimeout(() => {
      clickHandled.current = false;
    }, 0);
    scene?.requestFrame();
  };

  const padded = useDragPad(
    scene,
    root,
    { down: (point) => press(point.x), move: (point) => drag(point.x), up: release },
    !disabled,
  );

  return (
    <>
      <button
        {...props}
        ref={rootRef}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        style={tint ? ({ ...props.style, "--lg-switch-on": tint } as CSSProperties) : props.style}
        data-lg-switch=""
        data-lg-on={checked || undefined}
        onClick={chain((event: MouseEvent<HTMLButtonElement>) => {
          // A pointer press already decided; keyboard and assistive clicks toggle here.
          if (clickHandled.current) {
            clickHandled.current = false;
            return;
          }
          if (!event.defaultPrevented) setChecked(!checked);
        }, onClick)}
        onPointerDown={chain((event: PointerEvent<HTMLButtonElement>) => {
          if (event.defaultPrevented || event.button !== 0 || pointer.current !== null || !root)
            return;
          if (padded && event.pointerType === "touch") return;
          if (!press(pointIn(event, root).x)) return;
          pointer.current = event.pointerId;
          root.setPointerCapture(event.pointerId);
        }, onPointerDown)}
        onPointerMove={chain((event: PointerEvent<HTMLButtonElement>) => {
          if (event.pointerId === pointer.current && root) drag(pointIn(event, root).x);
        }, onPointerMove)}
        onPointerUp={chain((event: PointerEvent<HTMLButtonElement>) => {
          if (event.pointerId !== pointer.current) return;
          pointer.current = null;
          release(true);
        }, onPointerUp)}
        onPointerCancel={chain((event: PointerEvent<HTMLButtonElement>) => {
          if (event.pointerId !== pointer.current) return;
          pointer.current = null;
          release(false);
        }, onPointerCancel)}
        onLostPointerCapture={chain((event: PointerEvent<HTMLButtonElement>) => {
          if (event.pointerId !== pointer.current) return;
          pointer.current = null;
          release(false);
        }, onLostPointerCapture)}
        onKeyDown={chain((event: KeyboardEvent<HTMLButtonElement>) => {
          // The thumb lifts while the key is held, like a press.
          if (
            !event.repeat &&
            (event.key === " " || event.key === "Enter") &&
            !disabled &&
            machine
          ) {
            layout();
            machine.press(0, performance.now());
            scene?.requestFrame();
          }
        }, onKeyDown)}
        onKeyUp={chain((event: KeyboardEvent<HTMLButtonElement>) => {
          if (
            (event.key === " " || event.key === "Enter") &&
            machine?.pressed &&
            pointer.current === null
          ) {
            machine.release(false, performance.now());
            scene?.requestFrame();
          }
        }, onKeyUp)}
        onBlur={chain(() => {
          if (machine?.pressed && pointer.current === null) {
            machine.release(false, performance.now());
            scene?.requestFrame();
          }
        }, onBlur)}
      >
        <span ref={thumbRef} data-lg-switch-thumb="">
          <span ref={face} data-lg-thumb-face="" data-lg-ignore="" />
        </span>
      </button>
      {name !== undefined && checked && <input type="hidden" name={name} value={value} />}
    </>
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
