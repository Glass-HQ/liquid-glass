import { cloneElement, createElement, isValidElement } from "react";
import type {
  ComponentPropsWithRef,
  CSSProperties,
  ElementType,
  ReactElement,
  ReactNode,
  Ref,
} from "react";
import type { Appearance, MaterialKind } from "../protocol";
import type { RadiusSpec } from "../core/geometry";
import { SurfaceContext, useGlassSurface, useMergedRef } from "./hooks";

export interface GlassSurfaceOwnProps {
  /** Default: the scene's material. */
  material?: MaterialKind;
  /** CSS color laid over the glass; its alpha is the strength. */
  tint?: string | null;
  /** "capsule", one radius or four. Default: the element's own border-radius. */
  radius?: RadiusSpec;
  /** 0 for circular corners, 1 for continuous ones. Default: 1. */
  smoothing?: number;
  /** Draw this surface's text and icons in the glass, so lenses magnify them. */
  labelsInGlass?: boolean;
  /** How far the glass may draw outside the element, px. Default: room for its shadow. */
  bleed?: number;
  /** Glass floating above content (menus, popovers, dialogs). */
  floating?: boolean;
  /** Light or dark glass whatever the scene's appearance (a media viewer that is always dark). */
  appearance?: Appearance;
  /** Adapt to what is behind (tone flips, dimming, shadow). Default: the scene's `adaptive`. */
  adaptive?: boolean;
  /**
   * Highlights along the rim that follow the pointer, or the device's tilt where the browser
   * reports it. Default: the scene's.
   */
  specular?: boolean;
  /**
   * Render this element instead of a `div`, with the surface's props merged into it (classes
   * joined, styles merged, handlers chained, refs merged).
   */
  render?: ReactElement;
  children?: ReactNode;
}

export type GlassSurfaceProps<T extends ElementType = "div"> = GlassSurfaceOwnProps & {
  /** The element type to render. Default: "div". */
  as?: T;
} & Omit<ComponentPropsWithRef<T>, keyof GlassSurfaceOwnProps | "as">;

type AnyProps = Record<string, unknown> & { ref?: Ref<HTMLElement> };

/** Props of a `render` element merged with the surface's own: theirs win, except as noted. */
export function mergeProps(base: AnyProps, own: AnyProps): AnyProps {
  const merged: AnyProps = { ...base, ...own };
  for (const key of Object.keys(own)) {
    const a = base[key];
    const b = own[key];
    if (key === "className" && typeof a === "string" && typeof b === "string")
      merged[key] = `${a} ${b}`;
    else if (key === "style" && a && b)
      merged[key] = { ...(a as CSSProperties), ...(b as CSSProperties) };
    else if (/^on[A-Z]/.test(key) && typeof a === "function" && typeof b === "function")
      merged[key] = (...args: unknown[]) => {
        Reflect.apply(a, undefined, args);
        Reflect.apply(b, undefined, args);
      };
  }
  return merged;
}

/** Glass behind its children. Any element can be glass: use `as` or `render`. */
export function GlassSurface<T extends ElementType = "div">(props: GlassSurfaceProps<T>) {
  const {
    material,
    tint,
    radius,
    smoothing,
    labelsInGlass,
    bleed,
    floating,
    appearance,
    adaptive,
    specular,
    render,
    as,
    children,
    ref,
    ...rest
  } = props as GlassSurfaceProps & { as?: ElementType };
  const { ref: surfaceRef, surface } = useGlassSurface({
    radius,
    smoothing,
    material,
    tint,
    labelsInGlass,
    bleed,
    floating,
    appearance,
    adaptive,
    specular,
    body: true,
    overhang: undefined,
    lensHeight: undefined,
  });
  const element = render && isValidElement<AnyProps>(render) ? render : null;
  const mergedRef = useMergedRef<HTMLElement>(surfaceRef, ref, element?.props.ref);
  const content = <SurfaceContext value={surface}>{children}</SurfaceContext>;

  if (element)
    return cloneElement(
      element,
      { ...mergeProps(element.props, rest as AnyProps), ref: mergedRef },
      content,
    );
  return createElement(as ?? "div", { ...rest, ref: mergedRef }, content);
}
