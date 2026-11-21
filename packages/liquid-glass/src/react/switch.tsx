import { useGlassForeground } from "./scene.js";
import { useMergedRef } from "./merged-ref.js";
import { GlassShape } from "./shape.js";
import { useRef, useState } from "react";
import type { ComponentPropsWithRef, CSSProperties } from "react";
import { Switch } from "@base-ui/react/switch";
import { switchDragState } from "./value-control-motion.js";
import { ControlThumb } from "./control-thumb.js";
import type { ControlMotionOptions } from "../dom/control-motion.js";
import type { MaterialOptions } from "../core/materials.js";

export interface GlassSwitchProps
  extends
    Omit<
      ComponentPropsWithRef<typeof Switch.Root>,
      "className" | "style" | "children" | "render" | "nativeButton"
    >,
    MaterialOptions,
    ControlMotionOptions {
  className?: string;
  style?: CSSProperties;
}
export function GlassSwitch({
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
  ...props
}: GlassSwitchProps) {
  const foregroundRef = useGlassForeground();
  const mergedRef = useMergedRef(props.ref, foregroundRef);
  const [pressed, setPressed] = useState(false);
  const [position, setPosition] = useState<number | null>(null);
  const pointer = useRef<{
    id: number;
    x: number;
    start: number;
    current: number;
    left: number;
    width: number;
    rtl: boolean;
    oppositeHalf: boolean;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  // A disabled switch, like a read-only one, ignores drags and key presses.
  const locked = props.readOnly || props.disabled;
  return (
    <Switch.Root
      {...props}
      ref={mergedRef}
      nativeButton={false}
      className={`lg-switch ${className}`}
      style={{ ...(tint === undefined ? {} : { "--lg-accent": tint }), ...style }}
      render={(rootProps, state) => (
        <span
          {...rootProps}
          role="switch"
          aria-checked={state.checked}
          tabIndex={rootProps.tabIndex ?? 0}
          style={
            {
              ...rootProps.style,
              "--lg-switch-position": position ?? (state.checked ? 1 : 0),
            } as CSSProperties
          }
          data-presentation-checked={
            position === null ? undefined : position === 1 ? "true" : "false"
          }
          onPointerDown={(event) => {
            rootProps.onPointerDown?.(event);
            if (event.defaultPrevented || locked || event.button !== 0) return;
            suppressClick.current = false;
            const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
            const start = state.checked ? 1 : 0;
            const rect = event.currentTarget.getBoundingClientRect();
            const initialHalf = event.clientX >= rect.left + rect.width / 2 !== rtl;
            pointer.current = {
              id: event.pointerId,
              x: event.clientX,
              start,
              current: start,
              left: rect.left,
              width: rect.width,
              rtl,
              oppositeHalf: initialHalf !== state.checked,
              moved: false,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
            setPosition(start);
            setPressed(true);
          }}
          onPointerMove={(event) => {
            rootProps.onPointerMove?.(event);
            const drag = pointer.current;
            if (!drag || drag.id !== event.pointerId || event.defaultPrevented) return;
            const delta = event.clientX - drag.x;
            drag.moved ||= Math.abs(delta) > 3;
            drag.current = Number(switchDragState(drag, event.clientX));
            if (drag.moved) setPosition(drag.current);
          }}
          onPointerUp={(event) => {
            rootProps.onPointerUp?.(event);
            const drag = pointer.current;
            if (!drag || drag.id !== event.pointerId) return;
            pointer.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
            if (drag.moved) {
              if (!event.defaultPrevented && drag.current >= 0.5 !== state.checked)
                event.currentTarget.click();
              // The following browser click must not toggle a committed drag a second time.
              suppressClick.current = true;
            }
            setPosition(null);
            setPressed(false);
          }}
          onPointerCancel={(event) => {
            rootProps.onPointerCancel?.(event);
            pointer.current = null;
            suppressClick.current = true;
            setPosition(null);
            setPressed(false);
          }}
          onLostPointerCapture={(event) => {
            rootProps.onLostPointerCapture?.(event);
            if (!pointer.current) return;
            pointer.current = null;
            suppressClick.current = true;
            setPosition(null);
            setPressed(false);
          }}
          onClickCapture={(event) => {
            if (suppressClick.current) {
              suppressClick.current = false;
              event.preventDefault();
              event.stopPropagation();
              return;
            }
            rootProps.onClickCapture?.(event);
          }}
          onKeyDown={(event) => {
            rootProps.onKeyDown?.(event);
            suppressClick.current = false;
            if (!event.defaultPrevented && !locked && (event.key === " " || event.key === "Enter"))
              setPressed(true);
          }}
          onKeyUp={(event) => {
            rootProps.onKeyUp?.(event);
            setPressed(false);
          }}
          onBlur={(event) => {
            rootProps.onBlur?.(event);
            setPressed(false);
          }}
        />
      )}
    >
      <GlassShape
        radius="capsule"
        render={<span />}
        className="lg-switch-track"
        aria-hidden="true"
      />
      <Switch.Thumb
        render={(rootProps) => (
          <ControlThumb
            {...rootProps}
            tag="span"
            pressed={pressed}
            motion={motion}
            interactive={interactive}
            options={{ material, appearance, radius, refraction, specular }}
            className="lg-switch-thumb"
          />
        )}
      />
    </Switch.Root>
  );
}
