import type { MapGeometry } from "../gpu/index.js";
import type { MaterialMaps } from "./maps.js";
import { touchMaps } from "./maps.js";

export type MapPlane = "displacement" | "mask" | "highlight" | "outline";
const resultSuffix: Record<MapPlane, string> = { displacement: "map", mask: "mask", highlight: "light", outline: "outline" };
/** Map resources belong to a surface, even when its material branch is
 * regrouped as another surface enters, moves nearby, or is absorbed. */
export const surfaceMapResult = (serial: number, plane: MapPlane): string => `s${serial}${resultSuffix[plane]}`;

/** Beyond two heights, Lisse capsule ends are independent of its width.
 * Bake one longer capsule and reuse its ends instead of readback per frame. */
export function capsuleMapGeometry(g: MapGeometry): MapGeometry | undefined {
  if (g.outline || g.radius !== "capsule" || !Number.isFinite(g.width) ||
    !Number.isFinite(g.height) || g.height <= 0 || g.width < g.height * 2) return;
  return { ...g, width: g.height * 3 };
}

/** Map images are long data URLs. Filter markup carries a short token
 * instead, so parsing a frame's markup stays cheap; the filter patcher
 * resolves a token only when an image primitive's map actually changes. */
const tokens = new Map<string, string>();
const urls = new Map<string, string>();
let nextToken = 0;
export function mapToken(url: string): string {
  let token = tokens.get(url);
  if (!token) { token = `m${++nextToken}`; tokens.set(url, token); urls.set(token, url); }
  return token;
}
export function mapUrl(token: string): string | undefined {
  return urls.get(token);
}
/** Forget a released map image. */
export function releaseMapToken(url: string): void {
  const token = tokens.get(url);
  if (token) { tokens.delete(url); urls.delete(token); }
}

/** Place GPU pixels in SVG filter coordinates. A pressed or stretched
 * capsule keeps round ends: caps scale with its height and only the straight
 * middle stretches. No DOM rasterization. */
export function mapImage(maps: MaterialMaps, plane: MapPlane, result: string,
  x: number, y: number, width: number, height: number, unitX = 1, unitY = 1): string {
  const image = (url: string, left: number, w: number, name: string) =>
    `<feImage data-map="${mapToken(url)}" x="${left / unitX}" y="${y / unitY}" width="${w / unitX}" height="${height / unitY}" preserveAspectRatio="none" result="${name}"/>`;
  touchMaps(maps);
  const slices = maps.capsule;
  const cap = slices ? slices.cap * height / slices.height : 0;
  if (!slices || width < cap * 2) return image(maps[plane], x, width, result);
  const [left, middle, right] = slices.planes[plane];
  // The middle runs half a pixel under each cap, so fractional slice edges
  // never leave a seam; it is uniform along its length, so the overlap is exact.
  return image(middle, x + cap - 0.5, width - cap * 2 + 1, `${result}M`) +
    image(left, x, cap, `${result}L`) +
    image(right, x + width - cap, cap, `${result}R`) +
    `<feMerge result="${result}" x="${x / unitX}" y="${y / unitY}" width="${width / unitX}" height="${height / unitY}"><feMergeNode in="${result}M"/><feMergeNode in="${result}L"/><feMergeNode in="${result}R"/></feMerge>`;
}
