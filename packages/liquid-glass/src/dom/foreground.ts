import { materials } from "../core/materials.js";
import type { MaterialOptions } from "../core/materials.js";
import type { MaterialMaps } from "./maps.js";
import { mapImage } from "./map-image.js";
import type { MapPlane } from "./map-image.js";

export interface ForegroundLens {
  element: HTMLElement;
  x: number; y: number; w: number; h: number;
  opacity: number;
  options: MaterialOptions;
  maps?: MaterialMaps;
}

/** Compare sibling stacking branches before falling back to document order. */
export function comparePaintOrder(a: HTMLElement, b: HTMLElement): number {
  if (a === b) return 0;
  const path = (element: HTMLElement) => {
    const result: HTMLElement[] = [];
    for (let node: HTMLElement | null = element; node; node = node.parentElement) result.unshift(node);
    return result;
  };
  const ap = path(a), bp = path(b);
  let i = 0;
  while (ap[i] && ap[i] === bp[i]) i++;
  const z = (nodes: HTMLElement[]) => {
    for (const node of nodes.slice(i)) {
      const style = getComputedStyle(node);
      if (style.zIndex !== "auto" && style.position !== "static") return Number(style.zIndex) || 0;
    }
    return 0;
  };
  const delta = z(ap) - z(bp);
  return delta || (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
}

export function overlaps(a: Pick<ForegroundLens, "x" | "y" | "w" | "h">, b: Pick<ForegroundLens, "x" | "y" | "w" | "h">): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Filter live foreground DOM through higher lenses, without repainting their rims.
 * Transparent input must stay transparent: unlike the backdrop pass, no edge
 * extension or opaque material fill belongs in this foreground contribution.
 */
export function foregroundFilter(id: string, target: ForegroundLens, overlays: readonly ForegroundLens[]): string {
  // Scene measurements are viewport pixels; a filter runs before its target's
  // CSS scale. Put each axis back into the target's local coordinate space.
  const sx = target.w > 0 ? (target.element?.offsetWidth || target.w) / target.w : 1;
  const sy = target.h > 0 ? (target.element?.offsetHeight || target.h) / target.h : 1;
  const displacementScale = Math.max(sx, sy);
  const anisotropic = Math.abs(sx - sy) > 1e-6;
  const parts: string[] = [];
  let input = "SourceGraphic";
  for (const [i, lens] of overlays.entries()) {
    if (!lens.maps) continue;
    const p = `f${i}`, x = lens.x - target.x - 2, y = lens.y - target.y - 2;
    const image = (plane: MapPlane, result: string) => mapImage(lens.maps!, plane, result, x, y, lens.w + 4, lens.h + 4, 1 / sx, 1 / sy);
    const region = (margin = 0) => `x="${(x - margin) * sx}" y="${(y - margin) * sy}" width="${(lens.w + 4 + 2 * margin) * sx}" height="${(lens.h + 4 + 2 * margin) * sy}"`;
    const bounds = region();
    const opaque = lens.opacity >= 1;
    parts.push(image("mask", opaque ? `${p}mask` : `${p}rawmask`), image("displacement", anisotropic ? `${p}rawmap` : `${p}map`));
    // feDisplacementMap has one scalar for both axes. Compress its channels
    // around neutral to match unequal target scales without clipping values.
    if (anisotropic) parts.push(`<feComponentTransfer in="${p}rawmap" ${bounds} result="${p}map"><feFuncR type="linear" slope="${sx / displacementScale}" intercept="${(1 - sx / displacementScale) / 2}"/><feFuncG type="linear" slope="${sy / displacementScale}" intercept="${(1 - sy / displacementScale) / 2}"/></feComponentTransfer>`);
    if (!opaque) parts.push(`<feComponentTransfer in="${p}rawmask" ${bounds} result="${p}mask"><feFuncA type="linear" slope="${lens.opacity}"/></feComponentTransfer>`);
    const blur = materials[lens.options.material ?? "clear"].blur;
    const refraction = lens.options.refraction ?? materials[lens.options.material ?? "clear"].refraction;
    // Only the lens samples blurred foreground. Preserve its whole sampling
    // neighborhood while bounding the expensive intermediate; the untouched
    // input still carries all foreground overflow through the final merge.
    if (blur > 0) parts.push(`<feGaussianBlur in="${input}" ${region(Math.ceil(3 * blur + Math.abs(refraction) + 2))} stdDeviation="${blur * sx} ${blur * sy}" result="${p}blur"/>`);
    // Every pixel the mask reveals lies inside the opaque displacement map.
    // Neutral filling outside that map cannot contribute to the final image.
    parts.push(`<feDisplacementMap in="${blur > 0 ? `${p}blur` : input}" in2="${p}map" ${bounds} scale="${refraction * 2 * displacementScale}" xChannelSelector="R" yChannelSelector="G" result="${p}refracted"/>`);
    parts.push(`<feComposite in="${p}refracted" in2="${p}mask" operator="in" ${bounds} result="${p}inside"/><feComposite in="${input}" in2="${p}mask" operator="out" result="${p}outside"/><feMerge result="${p}result"><feMergeNode in="${p}outside"/><feMergeNode in="${p}inside"/></feMerge>`);
    input = `${p}result`;
  }
  return `<filter id="${id}" x="-1" y="-1" width="3" height="3" filterUnits="objectBoundingBox" primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB">${parts.join("")}</filter>`;
}
