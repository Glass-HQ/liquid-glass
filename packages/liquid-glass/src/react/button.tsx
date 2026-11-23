import { useMemo, useRef } from "react";
import type { ComponentPropsWithRef, KeyboardEvent, PointerEvent } from "react";
import type { Appearance, MaterialKind } from "../protocol";
import type { RadiusSpec } from "../core/geometry";
import {
  pressGrowth,
  SurfaceContext,
  chain,
  pointIn,
  prefersReducedMotion,
  useGlassEngine,
  useGlassScene,
  useGlassSurface,
  useMergedRef,
  useSurfaceMotion,
} from "./hooks";

export interface GlassButtonProps extends ComponentPropsWithRef<"button"> {
  /**
   * Highlights along the rim that follow the pointer, or the device's tilt where the browser
   * reports it. Default: the scene's.
   */
  specular?: boolean;
  material?: MaterialKind;
  tint?: string | null;
  /** Default: the button's own border-radius. */
  radius?: RadiusSpec;
  labelsInGlass?: boolean;
  bleed?: number;
  /** Light or dark glass whatever the scene's appearance. Default: the scene's. */
  appearance?: Appearance;
  /**
   * Scale at full press. Default: 1.164 for buttons up to 66 px wide (at least
   * 2.5 px of growth); wider buttons grow by the same px as a 66 px one.
   */
  pressScale?: number;
}

/** A real `<button>` that is glass: it grows, lights up under the pointer and springs back. */
export function GlassButton({
  specular,
  material,
  tint,
  radius,
  labelsInGlass,
  bleed,
  appearance,
  pressScale,
  ref,
  type = "button",
  children,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onLostPointerCapture,
  onKeyDown,
  onKeyUp,
  onBlur,
  ...props
}: GlassButtonProps) {
  const scene = useGlassScene();
  const engine = useGlassEngine();
  const {
    ref: surfaceRef,
    surface,
    element,
  } = useGlassSurface({
    specular,
    radius,
    material,
    tint,
    labelsInGlass,
    bleed,
    appearance,
    // Room for the full growth plus the rubber-band pull.
    overhang: engine
      ? (engine.press.measuredSize * (engine.press.scale - 1)) / 2 + engine.press.pullLimit + 2
      : undefined,
    body: true,
    floating: undefined,
    lensHeight: undefined,
  });
  const mergedRef = useMergedRef<HTMLButtonElement>(surfaceRef, ref);
  // Null until the engine has loaded; until then a press does nothing but click.
  const machine = useMemo(
    () => engine?.createPressMachine({ scale: pressScale, reducedMotion: prefersReducedMotion }),
    [engine, pressScale],
  );
  const pointer = useRef<number | null>(null);

  useSurfaceMotion(surface, "press", (_now, dt, s) => {
    if (!machine || !engine) return { shapes: [], moving: false };
    machine.size(s.size.width, s.size.height);
    const frame = machine.advance(dt);
    pressGrowth.set(s.element, frame.scale);
    const resting = !frame.moving && !machine.pressed && frame.light === 0 && frame.scale === 1;
    return { shapes: resting ? [] : engine.pressShapes(frame, s.radii), moving: frame.moving };
  });

  const start = () => {
    if (props.disabled || !machine) return;
    machine.press();
    scene?.requestFrame();
  };
  const end = () => {
    pointer.current = null;
    machine?.release();
    scene?.requestFrame();
  };

  return (
    <button
      {...props}
      type={type}
      ref={mergedRef}
      data-lg-button=""
      onPointerDown={chain((event: PointerEvent<HTMLButtonElement>) => {
        if (event.defaultPrevented || event.button !== 0 || pointer.current !== null) return;
        pointer.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        start();
      }, onPointerDown)}
      onPointerMove={chain((event: PointerEvent<HTMLButtonElement>) => {
        if (event.pointerId !== pointer.current || !element || !machine) return;
        machine.move(pointIn(event, element));
        scene?.requestFrame();
      }, onPointerMove)}
      onPointerUp={chain((event: PointerEvent<HTMLButtonElement>) => {
        if (event.pointerId === pointer.current) end();
      }, onPointerUp)}
      onPointerCancel={chain((event: PointerEvent<HTMLButtonElement>) => {
        if (event.pointerId === pointer.current) end();
      }, onPointerCancel)}
      onLostPointerCapture={chain((event: PointerEvent<HTMLButtonElement>) => {
        if (event.pointerId === pointer.current) end();
      }, onLostPointerCapture)}
      onKeyDown={chain((event: KeyboardEvent<HTMLButtonElement>) => {
        if (!event.repeat && (event.key === " " || event.key === "Enter")) start();
      }, onKeyDown)}
      onKeyUp={chain((event: KeyboardEvent<HTMLButtonElement>) => {
        if (event.key === " " || event.key === "Enter") end();
      }, onKeyUp)}
      onBlur={chain(() => {
        if (machine?.pressed) end();
      }, onBlur)}
    >
      <SurfaceContext value={surface}>{children}</SurfaceContext>
    </button>
  );
}
