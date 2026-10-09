import type { CSSProperties, ComponentPropsWithRef } from "react";
import { Button } from "@base-ui/react/button";
import type { MaterialOptions } from "../core/materials.js";
import { GlassSurface } from "./surface.js";
import type { GlassMotionProps } from "./surface.js";
export type GlassButtonSize = "default" | "xs" | "sm" | "lg" | "icon" | "icon-xs" | "icon-sm" | "icon-lg";
export interface GlassButtonProps
  extends
    Omit<ComponentPropsWithRef<typeof Button>, "className" | "style">,
    MaterialOptions,
    Pick<GlassMotionProps, "interactive" | "motion"> {
  className?: string;
  style?: CSSProperties;
  size?: GlassButtonSize;
}
export function GlassButton({
  material,
  appearance,
  radius = "capsule",
  refraction,
  tint,
  interactive = true,
  motion,
  size = "default",
  className = "",
  style,
  children,
  ...props
}: GlassButtonProps) {
  return (
    <GlassSurface
      material={material}
      appearance={appearance}
      radius={size.startsWith("icon") ? "circle" : radius}
      refraction={refraction}
      tint={tint}
      interactive={interactive}
      motion={motion}
      className={`lg-button ${className}`}
      style={style}
      data-size={size}
      render={<Button {...props} />}
    >
      {children}
    </GlassSurface>
  );
}
