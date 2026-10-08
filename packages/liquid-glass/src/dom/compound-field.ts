import type { MaterialOptions } from "../core/materials.js";
import type { FilterBounds } from "./filter-bounds.js";
import { surfaceMapResult } from "./map-image.js";
import type { MapPlane } from "./map-image.js";

interface FieldSurface {
  element: Element;
  options: MaterialOptions;
  maps?: unknown;
  x: number; y: number; w: number; h: number;
  opacity: number;
  baseOpacity?: number;
}
interface FieldContext<T> {
  source(surface: T): Element | undefined;
  nested(surface: T): boolean;
  refraction(surface: T): number;
  reach(surface: T): number;
}
export const fieldTouches = (a: Pick<FieldSurface, "x" | "y" | "w" | "h">, b: Pick<FieldSurface, "x" | "y" | "w" | "h">, reach = 0): boolean =>
  a.x < b.x + b.w + reach && b.x - reach < a.x + a.w && a.y < b.y + b.h + reach && b.y - reach < a.y + a.h;

/** A detached popup and its source can share one optical field when they
 * have the same opaque material. Moving the source to the popup's paint
 * position must not change any intervening surface's sampled backdrop. */
export function compoundSources<T extends FieldSurface>(ordered: readonly T[], context: FieldContext<T>): Map<T, T> {
  const sources = new Map(ordered.map((surface) => [surface, context.source(surface)]));
  const claims = new Map<Element, number>();
  for (const source of sources.values()) if (source) claims.set(source, (claims.get(source) ?? 0) + 1);
  const pairs = new Map<T, T>();
  for (const [index, popup] of ordered.entries()) {
    const element = sources.get(popup);
    const source = element && ordered.find((candidate) => candidate.element === element);
    if (!source || source === popup || !source.maps || !popup.maps || claims.get(element!) !== 1 ||
        sources.get(source) || claims.has(popup.element) ||
        (source.baseOpacity ?? source.opacity) < .999 || (popup.baseOpacity ?? popup.opacity) < .999 ||
        context.nested(source) || context.nested(popup)) continue;
    const a = source.options, b = popup.options;
    if ((a.material ?? "clear") !== (b.material ?? "clear") || (a.appearance ?? "light") !== (b.appearance ?? "light") ||
        a.tint !== b.tint || context.refraction(source) !== context.refraction(popup)) continue;
    const start = ordered.indexOf(source);
    if (start >= index || ordered.slice(start + 1, index).some((other) => other.maps && other.opacity >= .001 &&
        fieldTouches(source, other, Math.max(context.reach(source), context.reach(other))))) continue;
    pairs.set(popup, source);
  }
  return pairs;
}

interface FieldMember { serial: number; opacity: number; baseOpacity?: number }
/** Draw one plane of a compound field. Displacement emits the real mask
 * images first, so its coverage and the subsequent mask plane share them. */
export function compoundFieldImage<T extends FieldMember>(source: T, popup: T, plane: MapPlane, result: string, box: FilterBounds,
  image: (member: T, plane: MapPlane, result: string) => string): string {
  const region = `x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}"`;
  const a = surfaceMapResult(source.serial, plane), b = surfaceMapResult(popup.serial, plane);
  const sourceMask = `${surfaceMapResult(source.serial, "mask")}field`, popupMask = surfaceMapResult(popup.serial, "mask");
  const weight = Math.max(0, Math.min(1, source.opacity / (source.baseOpacity || 1)));
  const merge = (first: string, second: string) => `<feMerge result="${result}" ${region}><feMergeNode in="${first}"/><feMergeNode in="${second}"/></feMerge>`;
  if (plane === "mask") return merge(sourceMask, popupMask);
  const raw = image(source, plane, a) + image(popup, plane, b);
  if (plane === "displacement") {
    const mask = surfaceMapResult(source.serial, "mask");
    const masks = image(source, "mask", mask) + image(popup, "mask", popupMask)
      + `<feComponentTransfer in="${mask}" result="${sourceMask}" ${region}><feFuncA type="linear" slope="${weight}"/></feComponentTransfer>`;
    // The map's crossfade already changes alpha where only one rectangle
    // covers a pixel. Normalize before applying shape coverage; multiplying
    // those two alphas would square the handoff and change the displacement.
    return masks + raw + [a, b].map((name, index) => `<feComponentTransfer in="${name}" result="${name}opaque" ${region}><feFuncA type="linear" slope="0" intercept="1"/></feComponentTransfer><feComposite in="${name}opaque" in2="${index ? popupMask : sourceMask}" operator="in" result="${name}field" ${region}/>`).join("")
      + merge(`${a}field`, `${b}field`);
  }
  // The source's edges used to sit below the popup's material. Preserve
  // that occlusion even though both now share a single material pass.
  return raw + `<feComponentTransfer in="${a}" result="${a}faded" ${region}><feFuncA type="linear" slope="${weight}"/></feComponentTransfer>`
    + `<feComposite in="${a}faded" in2="${popupMask}" operator="out" result="${a}field" ${region}/>`
    + merge(`${a}field`, b);
}
