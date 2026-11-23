/**
 * Reading a surface's box from the DOM, and the placeholder canvas it is drawn into.
 */

import type { Radii } from "../protocol";
import { fitRadii } from "../core/geometry";

/** One CSS corner radius ("12px", "50%", "12px 8px") as a single circular radius. */
function cornerRadius(value: string, width: number, height: number): number {
  const parts = value.trim().split(/\s+/);
  const resolve = (part: string | undefined, basis: number) => {
    if (!part) return 0;
    const number = parseFloat(part);
    if (!Number.isFinite(number)) return 0;
    return part.endsWith("%") ? (number / 100) * basis : number;
  };
  const horizontal = resolve(parts[0], width);
  const vertical =
    parts.length > 1
      ? resolve(parts[1], height)
      : parts[0]?.endsWith("%")
        ? resolve(parts[0], height)
        : horizontal;
  // Glass corners are circular: an elliptical corner becomes its smaller radius.
  return Math.min(horizontal, vertical);
}

/** The element's computed corner radii, fitted to its size the way CSS does. */
export function computedRadii(style: CSSStyleDeclaration, width: number, height: number): Radii {
  return fitRadii(
    [
      cornerRadius(style.borderTopLeftRadius, width, height),
      cornerRadius(style.borderTopRightRadius, width, height),
      cornerRadius(style.borderBottomRightRadius, width, height),
      cornerRadius(style.borderBottomLeftRadius, width, height),
    ],
    { width, height },
  );
}

/** The product of the opacity of an element and all its ancestors. */
export function opacityProduct(element: Element, cache: Map<Element, number>): number {
  const chain: Element[] = [];
  let product = 1;
  for (let node: Element | null = element; node; node = node.parentElement) {
    const known = cache.get(node);
    if (known !== undefined) {
      product = known;
      break;
    }
    chain.push(node);
  }
  // Fill the cache from the top down so siblings share their ancestors' work.
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const node = chain[i]!;
    const own = parseFloat(getComputedStyle(node).opacity);
    product *= Number.isFinite(own) ? own : 1;
    cache.set(node, product);
  }
  return product;
}

/** The placeholder canvas a surface is drawn into: first child, behind the surface's content. */
export function createSurfaceCanvas(element: HTMLElement): HTMLCanvasElement {
  const canvas = element.ownerDocument.createElement("canvas");
  canvas.setAttribute("data-lg-canvas", "");
  canvas.setAttribute("aria-hidden", "true");
  canvas.setAttribute("data-lg-ignore", "");
  canvas.tabIndex = -1;
  element.prepend(canvas);
  return canvas;
}

export type Bleed = readonly [top: number, right: number, bottom: number, left: number];

/**
 * Where a surface's canvas lives.
 *
 * - "child": the surface's first child, `position: absolute`, behind the surface's content
 *   (`z-index: -1` in the surface's own stacking context). The compositor moves, scales and
 *   fades it with the surface, so CSS transforms and opacity need nothing from script.
 * - "sibling": just before the surface, for surfaces that clip or scroll their content (any
 *   `overflow` but `visible`). As a child the canvas would be clipped (no shadow, square
 *   corners), add to the scroll range and scroll with the content. As the previous sibling it
 *   shares the surface's containing block and stacking level, so it sits right below it; the
 *   surface's transform and opacity are copied to it every frame.
 */
export type CanvasHost = "child" | "sibling";

/** Whether an element clips its content, which would clip a canvas inside it. */
export function clipsContent(style: CSSStyleDeclaration): boolean {
  return style.overflowX !== "visible" || style.overflowY !== "visible";
}

/** Put the canvas where its host mode says, if it isn't there already. */
export function placeCanvas(
  canvas: HTMLCanvasElement,
  element: HTMLElement,
  host: CanvasHost,
): void {
  if (host === "child") {
    if (canvas.parentNode !== element || element.firstChild !== canvas) element.prepend(canvas);
  } else if (canvas.nextSibling !== element) {
    element.before(canvas);
  }
}

/** Inline styles a sibling canvas takes over from its surface; reset when it moves back inside. */
const SIBLING_STYLES = [
  "position",
  "zIndex",
  "transform",
  "transformOrigin",
  "opacity",
  "visibility",
] as const;

export function resetSiblingStyles(canvas: HTMLCanvasElement): void {
  for (const name of SIBLING_STYLES) canvas.style[name] = "";
}

/**
 * Where the canvas goes. As a child, absolute positions are relative to the surface's padding
 * box while shapes are in its border box, so the canvas is offset by the border as well as the
 * bleed. As a sibling, it shares the surface's containing block: offsetLeft/Top place it.
 */
export function canvasGeometry(
  size: { width: number; height: number },
  border: { left: number; top: number },
  bleed: Bleed,
  host: CanvasHost,
  offset: { left: number; top: number },
): { left: number; top: number; width: number; height: number } {
  const [top, right, bottom, left] = bleed;
  const x = host === "child" ? -border.left : offset.left;
  const y = host === "child" ? -border.top : offset.top;
  return {
    left: x - left,
    top: y - top,
    width: size.width + left + right,
    height: size.height + top + bottom,
  };
}

/**
 * The CSS a sibling canvas needs to sit and move exactly like its surface: the same stacking
 * level, the surface's own opacity (its ancestors' applies to both), and every transform
 * (`transform`, `translate`, `rotate`, `scale`) folded into one, about the same origin.
 * Percentages in `translate` are of the surface's box, so they are resolved here.
 */
export function siblingStyles(
  style: CSSStyleDeclaration,
  size: { width: number; height: number },
  bleed: Bleed,
): Record<(typeof SIBLING_STYLES)[number], string> {
  const parts: string[] = [];
  const translate = style.translate;
  if (translate && translate !== "none") {
    const [x = "0px", y = "0px", z = "0px"] = translate.split(/\s+/);
    const resolve = (value: string, basis: number) =>
      value.endsWith("%") ? `${(parseFloat(value) / 100) * basis}px` : value;
    parts.push(`translate3d(${resolve(x, size.width)}, ${resolve(y, size.height)}, ${z})`);
  }
  const rotate = style.rotate;
  if (rotate && rotate !== "none") {
    // "45deg", "x 45deg" or "1 0 0 45deg".
    const values = rotate.split(/\s+/);
    const axis = { x: "1, 0, 0", y: "0, 1, 0", z: "0, 0, 1" }[values[0] ?? ""];
    if (values.length === 1) parts.push(`rotate(${values[0]})`);
    else if (axis) parts.push(`rotate3d(${axis}, ${values[1]})`);
    else parts.push(`rotate3d(${values.join(", ")})`);
  }
  const scale = style.scale;
  if (scale && scale !== "none")
    parts.push(`scale3d(${[...scale.split(/\s+/), "1", "1"].slice(0, 3).join(", ")})`);
  if (style.transform && style.transform !== "none") parts.push(style.transform);
  const [ox = "0px", oy = "0px", oz = "0px"] = style.transformOrigin.split(/\s+/);
  const [top, , , left] = bleed;
  return {
    position: style.position === "fixed" ? "fixed" : "absolute",
    zIndex: style.zIndex,
    transform: parts.join(" "),
    transformOrigin: `${parseFloat(ox) + left}px ${parseFloat(oy) + top}px ${oz}`,
    opacity: style.opacity,
    visibility: style.visibility,
  };
}
