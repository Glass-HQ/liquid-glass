import type { MapGeometry } from "../gpu/geometry.js";
import type { MaterialMaps } from "./maps.js";
import { touchMaps } from "./maps.js";

export type MapPlane = "field" | "rim" | "light";
const resultSuffix: Record<MapPlane, string> = { field: "field", rim: "rim", light: "light" };
/** Map resources belong to a surface, even when its material branch is
 * regrouped as another surface enters, moves nearby, or is absorbed. */
export const surfaceMapResult = (serial: number, plane: MapPlane): string =>
  `s${serial}${resultSuffix[plane]}`;

/** Beyond two heights, Lisse capsule ends are independent of its width.
 * Bake one longer capsule and reuse its ends instead of readback per frame. */
export function capsuleMapGeometry(g: MapGeometry): MapGeometry | undefined {
  if (
    g.outline ||
    g.radius !== "capsule" ||
    !Number.isFinite(g.width) ||
    !Number.isFinite(g.height) ||
    g.height <= 0 ||
    g.width < g.height * 2
  )
    return;
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
  if (!token) {
    token = `m${++nextToken}`;
    tokens.set(url, token);
    urls.set(token, url);
  }
  return token;
}
export function mapUrl(token: string): string | undefined {
  return urls.get(token);
}
/** Forget a released map image. */
export function releaseMapToken(url: string): void {
  const token = tokens.get(url);
  if (token) {
    tokens.delete(url);
    urls.delete(token);
  }
}

/** Place GPU pixels in SVG filter coordinates. A pressed or stretched
 * capsule keeps round ends: caps scale with its height and only the straight
 * middle stretches. No DOM rasterization. */
export function mapImage(
  maps: MaterialMaps,
  plane: MapPlane,
  result: string,
  x: number,
  y: number,
  width: number,
  height: number,
  unitX = 1,
  unitY = 1,
): string {
  const image = (url: string, left: number, w: number, name: string) =>
    `<feImage data-map="${mapToken(url)}" x="${left / unitX}" y="${y / unitY}" width="${w / unitX}" height="${height / unitY}" preserveAspectRatio="none" result="${name}"/>`;
  touchMaps(maps);
  const slices = maps.capsule;
  const cap = slices ? (slices.cap * height) / slices.height : 0;
  if (!slices || width < cap * 2) return image(maps[plane], x, width, result);
  const [left, middle, right] = slices.planes[plane];
  // The middle runs half a pixel under each cap, so fractional slice edges
  // never leave a seam; it is uniform along its length, so the overlap is exact.
  return (
    image(middle, x + cap - 0.5, width - cap * 2 + 1, `${result}M`) +
    image(left, x, cap, `${result}L`) +
    image(right, x + width - cap, cap, `${result}R`) +
    `<feMerge result="${result}" x="${x / unitX}" y="${y / unitY}" width="${width / unitX}" height="${height / unitY}"><feMergeNode in="${result}M"/><feMergeNode in="${result}L"/><feMergeNode in="${result}R"/></feMerge>`
  );
}

/** Place one plane of maps cut into nine tiles (see `MaterialMaps.nine`):
 * corners at their own size and the strips between them stretched. Maps that
 * are not cut are placed whole. */
export function nineMapImage(
  maps: MaterialMaps,
  plane: MapPlane,
  result: string,
  x: number,
  y: number,
  width: number,
  height: number,
): string {
  const nine = maps.nine;
  if (!nine) return mapImage(maps, plane, result, x, y, width, height);
  touchMaps(maps);
  const tiles = nine.planes[plane];
  const cx = Math.min(nine.x, width / 2),
    cy = Math.min(nine.y, height / 2);
  const columns = [
    [x, cx],
    [x + cx, width - 2 * cx],
    [x + width - cx, cx],
  ];
  const rows = [
    [y, cy],
    [y + cy, height - 2 * cy],
    [y + height - cy, cy],
  ];
  const names: string[] = [];
  let markup = "";
  rows.forEach(([top, h], row) =>
    columns.forEach(([left, w], column) => {
      if (w < 0.01 || h < 0.01) return;
      const name = `${result}${row}${column}`;
      names.push(name);
      markup += `<feImage data-map="${mapToken(tiles[row * 3 + column])}" x="${left}" y="${top}" width="${w}" height="${h}" preserveAspectRatio="none" result="${name}"/>`;
    }),
  );
  // Tiles meet along fractional edges, where each covers part of a pixel. Laid
  // over each other, two halves make three quarters and the seam shows as a
  // line; added, they make the whole pixel.
  const region = `x="${x}" y="${y}" width="${width}" height="${height}"`;
  let sum = names[0]!;
  names.slice(1).forEach((name, index) => {
    const next = index === names.length - 2 ? result : `${result}+${index}`;
    markup += `<feComposite in="${sum}" in2="${name}" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" ${region} result="${next}"/>`;
    sum = next;
  });
  if (names.length === 1) markup += `<feOffset in="${sum}" ${region} result="${result}"/>`;
  return markup;
}
