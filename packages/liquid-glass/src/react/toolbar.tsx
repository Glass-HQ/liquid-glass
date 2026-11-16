import { Children, Fragment, cloneElement, isValidElement } from "react";
import type { CSSProperties, ComponentPropsWithRef, ReactNode } from "react";
import { Toolbar } from "@base-ui/react/toolbar";
import type { MaterialOptions } from "../core/materials.js";
import { GlassShape } from "./shape.js";
import { GlassSurface } from "./surface.js";
import type { GlassMotionProps } from "./surface.js";
export interface GlassToolbarProps
  extends
    Omit<ComponentPropsWithRef<typeof Toolbar.Root>, "className" | "style">,
    MaterialOptions,
    Pick<GlassMotionProps, "interactive" | "motion"> {
  className?: string;
  style?: CSSProperties;
}
export function GlassToolbar({
  material,
  appearance,
  radius = "capsule",
  refraction,
  tint,
  specular,
  interactive = true,
  motion,
  className = "",
  style,
  children,
  ...props
}: GlassToolbarProps) {
  // Fragments and arrays are transparent; spacers delimit optical surfaces.
  const items: ReactNode[] = [];
  const collect = (nodes: ReactNode, prefix = "") => {
    Children.forEach(Children.toArray(nodes), (child) => {
      if (isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment)
        collect(child.props.children, `${prefix}${child.key}/`);
      else
        items.push(
          isValidElement(child) ? cloneElement(child, { key: `${prefix}${child.key}` }) : child,
        );
    });
  };
  collect(children);
  const orientation = props.orientation ?? "horizontal";
  const clusters: ReactNode[] = [];
  let controls: ReactNode[] = [];
  const flush = () => {
    if (!controls.length) return;
    clusters.push(
      <GlassSurface
        key={`cluster-${clusters.length}`}
        material={material}
        appearance={appearance}
        radius={radius}
        refraction={refraction}
        tint={tint}
        specular={specular}
        interactive={interactive}
        motion={motion}
        className="lg-toolbar-cluster"
        data-orientation={orientation}
      >
        {controls}
      </GlassSurface>,
    );
    controls = [];
  };
  for (const item of items) {
    if (isValidElement(item) && item.type === GlassToolbarSpacer) {
      flush();
      clusters.push(item);
    } else controls.push(item);
  }
  flush();
  return (
    <Toolbar.Root
      aria-label="Toolbar"
      {...props}
      style={style}
      className={`lg-toolbar ${className}`}
      data-segmented={clusters.length > 1 ? "" : undefined}
    >
      {clusters}
    </Toolbar.Root>
  );
}
export interface GlassToolbarButtonProps extends ComponentPropsWithRef<typeof Toolbar.Button> {
  /** Icon controls remain square; default controls fit their text. */
  size?: "icon" | "default";
}
export function GlassToolbarButton({
  className,
  size = "icon",
  ...props
}: GlassToolbarButtonProps) {
  return (
    <GlassShape
      radius={size === "icon" ? "circle" : "capsule"}
      render={
        <Toolbar.Button
          {...props}
          data-size={size}
          className={(state) =>
            `lg-toolbar-button ${typeof className === "function" ? className(state) : (className ?? "")}`
          }
        />
      }
    />
  );
}
export const GlassToolbarLink = Toolbar.Link;
export const GlassToolbarGroup = Toolbar.Group;

export interface GlassToolbarSpacerProps extends Omit<ComponentPropsWithRef<"span">, "children"> {
  /** Flexible spacers fill available space; fixed spacers keep a standard gap. */
  sizing?: "fixed" | "flexible";
}
export function GlassToolbarSpacer({
  sizing = "flexible",
  className = "",
  ...props
}: GlassToolbarSpacerProps) {
  return (
    <span
      {...props}
      aria-hidden="true"
      className={`lg-toolbar-spacer ${className}`}
      data-sizing={sizing}
    />
  );
}
