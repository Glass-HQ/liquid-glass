import { useLayoutEffect, useState } from "react";
import type { ComponentPropsWithRef, KeyboardEvent, PointerEvent } from "react";
import type { Appearance, MaterialKind, Radii, Rect, Shape } from "../protocol";
import type { RadiusSpec } from "../core/geometry";
import { GlassHighlight } from "./highlight";
import {
  SurfaceContext,
  chain,
  rectIn,
  useGlassScene,
  useGlassSurface,
  useMergedRef,
  useSurfaceMotion,
} from "./hooks";

export interface GlassToolbarProps extends ComponentPropsWithRef<"div"> {
  /**
   * Highlights along the rim that follow the pointer, or the device's tilt where the browser
   * reports it. Default: the scene's.
   */
  specular?: boolean;
  material?: MaterialKind;
  tint?: string | null;
  /** Default: "capsule". */
  radius?: RadiusSpec;
  /** The toolbar floats over content (a window's toolbar over a scrolling page). */
  floating?: boolean;
  appearance?: Appearance;
  /** Default: "horizontal". */
  orientation?: "horizontal" | "vertical";
}

const itemSelector = "[data-lg-toolbar-item]";
const partSelector = "[data-lg-toolbar-item],[data-lg-toolbar-separator],[data-lg-toolbar-spacer]";

/**
 * The toolbar's pieces of glass: one per run of tools between spacers, each as tall as the bar
 * and reaching its padding past the first and last tool of the run. Null without spacers: the
 * whole bar is one piece.
 */
function clusterRects(bar: HTMLElement, vertical: boolean): Rect[] | null {
  const parts = [...bar.querySelectorAll<HTMLElement>(partSelector)].filter(
    (part) => part.closest("[data-lg-toolbar]") === bar && !part.closest("[data-lg-menu-popup]"),
  );
  if (!parts.some((part) => part.hasAttribute("data-lg-toolbar-spacer"))) return null;
  const style = getComputedStyle(bar);
  const start = Number.parseFloat(vertical ? style.paddingTop : style.paddingLeft) || 0;
  const end = Number.parseFloat(vertical ? style.paddingBottom : style.paddingRight) || 0;
  const rects: Rect[] = [];
  let run: Rect[] = [];
  const flush = () => {
    if (run.length === 0) return;
    const from = Math.min(...run.map((r) => (vertical ? r.y : r.x))) - start;
    const to = Math.max(...run.map((r) => (vertical ? r.y + r.height : r.x + r.width))) + end;
    rects.push(
      vertical
        ? { x: 0, y: from, width: bar.offsetWidth, height: to - from }
        : { x: from, y: 0, width: to - from, height: bar.offsetHeight },
    );
    run = [];
  };
  for (const part of parts) {
    if (part.hasAttribute("data-lg-toolbar-spacer")) flush();
    else run.push(rectIn(part, bar));
  }
  flush();
  return rects;
}

function radiiOf(radius: RadiusSpec, rect: Rect): Radii {
  const half = Math.min(rect.width, rect.height) / 2;
  if (radius === "capsule") return [half, half, half, half];
  if (typeof radius === "number") {
    const r = Math.min(radius, half);
    return [r, r, r, r];
  }
  return [
    Math.min(radius[0], half),
    Math.min(radius[1], half),
    Math.min(radius[2], half),
    Math.min(radius[3], half),
  ];
}

/**
 * A row of tools on one piece of glass. A glass pill rests under the tool the pointer is over
 * or pressing, sliding from tool to tool, and concentric with the bar near its ends. Arrow
 * keys, Home and End move focus between the tools.
 */
export function GlassToolbar({
  specular,
  material,
  tint,
  radius = "capsule",
  floating,
  appearance,
  orientation = "horizontal",
  ref,
  children,
  onKeyDown,
  onPointerOver,
  onPointerLeave,
  onFocus,
  onBlur,
  ...props
}: GlassToolbarProps) {
  const {
    ref: surfaceRef,
    surface,
    element,
  } = useGlassSurface({
    specular,
    radius,
    material,
    tint,
    floating,
    appearance,
    body: true,
    labelsInGlass: undefined,
    bleed: undefined,
    overhang: undefined,
    lensHeight: undefined,
  });
  const mergedRef = useMergedRef<HTMLDivElement>(surfaceRef, ref);
  const scene = useGlassScene();
  const vertical = orientation === "vertical";
  // Spacers split the bar into separate pieces of glass, re-measured every frame it draws.
  useSurfaceMotion(surface, "clusters", (_now, _dt, s) => {
    const rects = clusterRects(s.element, vertical);
    const shapes: Shape[] = (rects ?? []).map((rect) => ({
      role: "body",
      rect,
      radii: radiiOf(radius, rect),
      lift: 0,
      magnify: 1,
      alpha: 1,
      merge: 0,
      tint: null,
      light: 0,
    }));
    return { shapes, moving: false };
  });
  useLayoutEffect(() => {
    scene?.requestFrame();
  });
  const [hovered, setHovered] = useState<HTMLElement | null>(null);
  const [focused, setFocused] = useState<HTMLElement | null>(null);

  const itemOf = (target: EventTarget | null): HTMLElement | null => {
    if (!(target instanceof Element) || !element) return null;
    const item = target.closest<HTMLElement>(itemSelector);
    return item && element.contains(item) && !item.matches(":disabled") ? item : null;
  };

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || !element) return;
    const items = [...element.querySelectorAll<HTMLElement>(itemSelector)].filter(
      (item) => !item.matches(":disabled"),
    );
    const current = items.findIndex((item) => item === document.activeElement);
    if (current < 0) return;
    const forward = orientation === "horizontal" ? "ArrowRight" : "ArrowDown";
    const back = orientation === "horizontal" ? "ArrowLeft" : "ArrowUp";
    const rtl = orientation === "horizontal" && getComputedStyle(element).direction === "rtl";
    let next: number;
    if (event.key === forward) next = current + (rtl ? -1 : 1);
    else if (event.key === back) next = current + (rtl ? 1 : -1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else return;
    event.preventDefault();
    items[(next + items.length) % items.length]?.focus();
  };

  return (
    <div
      role="toolbar"
      aria-orientation={orientation}
      data-lg-toolbar=""
      data-orientation={orientation}
      {...props}
      ref={mergedRef}
      onKeyDown={chain(keyDown, onKeyDown)}
      onPointerOver={chain((event: PointerEvent<HTMLDivElement>) => {
        if (event.pointerType === "mouse" || event.pointerType === "pen")
          setHovered(itemOf(event.target));
      }, onPointerOver)}
      onPointerLeave={chain(() => setHovered(null), onPointerLeave)}
      onFocus={chain((event: { target: EventTarget }) => {
        const item = itemOf(event.target);
        setFocused(item && item.matches(":focus-visible") ? item : null);
      }, onFocus)}
      onBlur={chain(() => setFocused(null), onBlur)}
    >
      <SurfaceContext value={surface}>
        <GlassHighlight target={hovered ?? focused} />
        {children}
      </SurfaceContext>
    </div>
  );
}

export interface GlassToolbarButtonProps extends ComponentPropsWithRef<"button"> {}

/** One tool: a real button, usually holding an icon (give it an `aria-label`). */
export function GlassToolbarButton({ type = "button", ...props }: GlassToolbarButtonProps) {
  return <button type={type} data-lg-toolbar-item="" {...props} />;
}

/** A thin rule between groups of tools. */
export function GlassToolbarSeparator(props: ComponentPropsWithRef<"span">) {
  return <span role="separator" data-lg-toolbar-separator="" {...props} />;
}

export interface GlassToolbarSpacerProps extends Omit<ComponentPropsWithRef<"span">, "children"> {
  /**
   * "flexible" fills the room the bar has (give the bar a width); "fixed" keeps a standard gap.
   * Either way the tools on each side become separate pieces of glass. Default: "flexible".
   */
  sizing?: "fixed" | "flexible";
}

/** Splits the toolbar into separate pieces of glass, with space between them. */
export function GlassToolbarSpacer({ sizing = "flexible", ...props }: GlassToolbarSpacerProps) {
  return <span aria-hidden="true" data-lg-toolbar-spacer="" data-sizing={sizing} {...props} />;
}
