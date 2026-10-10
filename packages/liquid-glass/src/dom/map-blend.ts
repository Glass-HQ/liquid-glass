import { mapImage } from "./map-image.js";
import type { MapPlane } from "./map-image.js";
import type { MaterialMaps } from "./maps.js";

export interface PlacedMap { maps: MaterialMaps; x: number; y: number; w: number; h: number }

/** Emit an animation's material map, retaining both inputs unless they name
 * the same pixels at the same position. This cuts redundant Gecko filter
 * operations during map preparation and at the end of a spring. */
export function blendMapImage(plane: MapPlane, result: string,
  placement: { a: PlacedMap; b: PlacedMap; mix: number },
  bounds: { x: number; y: number; w: number; h: number }, collapseIdentical = false): string {
  const { a, b, mix } = placement;
  const at = (p: PlacedMap, name: string) => mapImage(p.maps, plane, name, p.x - 2, p.y - 2, p.w + 4, p.h + 4);
  if (collapseIdentical && (a === b || (a.maps === b.maps && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h)))
    return at(a, result);
  return at(a, `${result}A`) + at(b, `${result}B`)
    + `<feComposite in="${result}A" in2="${result}B" operator="arithmetic" k1="0" k2="${(1 - mix).toFixed(4)}" k3="${mix.toFixed(4)}" k4="0" result="${result}" x="${bounds.x - 2}" y="${bounds.y - 2}" width="${bounds.w + 4}" height="${bounds.h + 4}"/>`;
}
