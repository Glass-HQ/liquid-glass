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
  const width = target.w, height = target.h;
  const parts: string[] = [];
  let input = "SourceGraphic";
  for (const [i, lens] of overlays.entries()) {
    if (!lens.maps) continue;
    const p = `f${i}`, x = lens.x - target.x - 2, y = lens.y - target.y - 2;
    const image = (plane: MapPlane, result: string) => mapImage(lens.maps!, plane, result, x, y, lens.w + 4, lens.h + 4, width, height);
    parts.push(image("mask", `${p}rawmask`), image("displacement", `${p}rawmap`));
    parts.push(`<feComponentTransfer in="${p}rawmask" result="${p}mask"><feFuncA type="linear" slope="${lens.opacity}"/></feComponentTransfer>`);
    parts.push(`<feFlood flood-color="rgb(128,128,128)" result="${p}neutral"/><feComposite in="${p}rawmap" in2="${p}neutral" operator="over" result="${p}map"/>`);
    const blur = materials[lens.options.material ?? "clear"].blur;
    parts.push(`<feGaussianBlur in="${input}" stdDeviation="${blur / width} ${blur / height}" result="${p}blur"/>`);
    const refraction = lens.options.refraction ?? materials[lens.options.material ?? "clear"].refraction;
    parts.push(`<feDisplacementMap in="${p}blur" in2="${p}map" scale="${refraction * 2 / width}" xChannelSelector="R" yChannelSelector="G" result="${p}refracted"/>`);
    parts.push(`<feComposite in="${p}refracted" in2="${p}mask" operator="in" result="${p}inside"/><feComposite in="${input}" in2="${p}mask" operator="out" result="${p}outside"/><feMerge result="${p}result"><feMergeNode in="${p}outside"/><feMergeNode in="${p}inside"/></feMerge>`);
    input = `${p}result`;
  }
  return `<filter id="${id}" x="-1" y="-1" width="3" height="3" filterUnits="objectBoundingBox" primitiveUnits="objectBoundingBox" color-interpolation-filters="sRGB">${parts.join("")}</filter>`;
}
