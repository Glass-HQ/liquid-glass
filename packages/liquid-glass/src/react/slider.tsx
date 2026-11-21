import { useGlassForeground } from "./scene.js";
import { useMergedRef } from "./merged-ref.js";
import { GlassShape } from "./shape.js";
import { useEffect, useState } from "react";
import type { ComponentPropsWithRef, CSSProperties } from "react";
import { Slider } from "@base-ui/react/slider";
import { ControlThumb } from "./control-thumb.js";
import type { ControlMotionOptions } from "../dom/control-motion.js";
import type { MaterialOptions } from "../core/materials.js";

export interface GlassSliderProps
  extends
    Omit<Slider.Root.Props<number>, "className" | "style" | "children">,
    MaterialOptions,
    ControlMotionOptions {
  className?: string;
  style?: CSSProperties;
  /** Visible marks at each step. Limited to 101 marks. */
  ticks?: boolean;
  /** Props and accessible name forwarded to the slider input. */
  thumbProps?: Omit<ComponentPropsWithRef<typeof Slider.Thumb>, "render" | "children" | "disabled">;
}
/** Single-value slider; use a small numeric step for continuous pointer travel. */
export function GlassSlider({
  material,
  appearance,
  tint,
  refraction,
  specular,
  radius = "capsule",
  motion,
  interactive = true,
  className = "",
  style,
  ticks = false,
  min = 0,
  max = 100,
  step = 0.1,
  thumbProps,
  "aria-label": ariaLabel,
  "aria-labelledby": labelledBy,
  ...props
}: GlassSliderProps) {
  if (
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    max <= min ||
    !Number.isFinite(max - min) ||
    !Number.isFinite(step) ||
    step <= 0
  )
    throw new RangeError("GlassSlider requires finite min < max and a positive finite step.");
  const intervals = (max - min) / step;
  if (
    ticks &&
    (intervals < 1 || intervals > 100 || Math.abs(intervals - Math.round(intervals)) > 1e-7)
  )
    throw new RangeError("Ticked sliders require 1–100 evenly divided intervals.");
  const foregroundRef = useGlassForeground();
  const mergedRef = useMergedRef(props.ref, foregroundRef);
  const { className: thumbClass = "", ...inputProps } = thumbProps ?? {};
  const [sliderPressed, setSliderPressed] = useState(false);
  useEffect(() => {
    if (!sliderPressed) return;
    const release = () => setSliderPressed(false);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      window.removeEventListener("blur", release);
    };
  }, [sliderPressed]);
  return (
    <Slider.Root<number>
      defaultValue={min}
      {...props}
      ref={mergedRef}
      min={min}
      max={max}
      step={step}
      className={`lg-slider ${className}`}
      style={{ ...(tint === undefined ? {} : { "--lg-accent": tint }), ...style }}
      data-ticks={ticks ? "" : undefined}
    >
      <Slider.Control
        className="lg-slider-control"
        onPointerDownCapture={(event) => {
          if (!event.defaultPrevented && !props.disabled && event.button === 0)
            setSliderPressed(true);
        }}
        onPointerUp={() => setSliderPressed(false)}
        onPointerCancel={() => setSliderPressed(false)}
        onLostPointerCapture={() => setSliderPressed(false)}
      >
        <GlassShape radius="capsule" render={<Slider.Track />} className="lg-slider-track">
          <GlassShape radius="capsule" render={<Slider.Indicator />} className="lg-slider-fill" />
        </GlassShape>
        {ticks && (
          <div className="lg-slider-ticks" aria-hidden="true">
            {Array.from({ length: Math.round(intervals) + 1 }, (_, i) => (
              <span key={i} />
            ))}
          </div>
        )}
        <Slider.Thumb
          aria-label={ariaLabel}
          aria-labelledby={labelledBy}
          {...inputProps}
          render={(rootProps, state) => (
            <ControlThumb
              {...rootProps}
              motion={motion}
              interactive={interactive}
              pressed={sliderPressed || state.dragging}
              options={{ material, appearance, radius, refraction, specular }}
              className={`lg-slider-thumb ${typeof thumbClass === "function" ? thumbClass(state) : thumbClass}`}
            />
          )}
        />
      </Slider.Control>
    </Slider.Root>
  );
}
