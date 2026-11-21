import { encodeMaterialPixels } from "./map-encoder.js";
import { getMaterialRenderer } from "./renderer.js";
import { mapScale } from "../gpu/geometry.js";
import type { MapGeometry } from "../gpu/geometry.js";
import materialShader from "../gpu/maps.wgsl";
import { refractionFor } from "../core/materials.js";
import { chromium } from "./engine.js";
import type { NineCut } from "./map-encoding.js";
import { capsuleMapGeometry, releaseMapToken } from "./map-image.js";
import type { MapPlane } from "./map-image.js";
import {
  claimFirstPaint,
  loadStoredMaps,
  peekStoredMaps,
  preloadStoredMaps,
  preloadedKeys,
  saveStoredMaps,
} from "./map-store.js";
export interface MaterialMaps {
  /** Displacement in red and green, shape coverage in alpha. */
  field: string;
  /** The outline just outside the shape, as black coverage. */
  rim: string;
  /** The key and fill light on the rim, as white light to add to the glass. */
  light: string;
  duration: number;
  /** Capsule maps reused at any width: CSS cap width, plane height, and slices. */
  capsule?: {
    cap: number;
    height: number;
    planes: Record<MapPlane, [string, string, string]>;
  };
  /** The maps cut for Chromium's backdrop glass, whose filters carry their
   * images, pixel for pixel, into every frame they draw: each plane's four
   * corners and the single column or row between them, stretched along the
   * straight edges. `x` and `y` are the corner tiles' size in CSS pixels; each
   * plane's nine tiles are listed row by row. */
  nine?: { x: number; y: number; planes: Record<MapPlane, string[]> };
}
/** How a shape's maps are cut into nine tiles, in map pixels: past its
 * corners and deeper than its rim bends, lights and shades, nothing changes
 * along a straight edge. Shapes with an outline of their own are not cut. */
function nineCut(g: MapGeometry): NineCut | undefined {
  if (g.outline) return;
  const scale = mapScale(g);
  const short = Math.min(g.width, g.height);
  const radius = typeof g.radius === "number" ? Math.min(g.radius, short / 2) : short / 2;
  // A continuous corner reaches 1.8125 radii along each side; the ring
  // shades up to 20 points in, and the rim bends up to its depth.
  const reach = Math.max(1.8125 * radius, 24, refractionFor(g.material ?? "regular", short).height);
  const tile = Math.ceil((reach + 3) * scale);
  return {
    x: Math.min(tile, Math.ceil(Math.ceil((g.width + 4) * scale) / 2)),
    y: Math.min(tile, Math.ceil(Math.ceil((g.height + 4) * scale) / 2)),
  };
}
/** Stored maps are only valid for the shader and encoder that produced them. */
const version = (() => {
  let hash = 2166136261;
  // The bend's depth is drawn into the maps, so a change to it is a new version too.
  const depths = (["clear", "regular", "lens"] as const)
    .map((material) => [16, 64, 160].map((size) => refractionFor(material, size).height).join())
    .join(";");
  for (const char of `${materialShader.wgsl}|png-sub-5|${depths}`)
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(36);
})();
const cache = new Map<string, Promise<MaterialMaps>>();
/** Stored maps are read and decoded while the page is still loading, so the
 * first frame that measures a surface finds its glass ready. */
if (typeof indexedDB !== "undefined" && typeof Image !== "undefined") {
  const prefix = `${version}|`;
  void preloadStoredMaps(prefix).then(() => {
    for (const stored of preloadedKeys()) {
      const key = stored.slice(prefix.length);
      let g: MapGeometry, slice: boolean;
      try {
        const [width, height, radius, dpr, appearance, material, outline, sliceCapsule] =
          JSON.parse(key) as [
            number,
            number,
            MapGeometry["radius"],
            number,
            MapGeometry["appearance"],
            MapGeometry["material"],
            MapGeometry["outline"],
            boolean,
          ];
        g = { width, height, radius, dpr, appearance, material, outline };
        slice = sliceCapsule;
      } catch {
        continue;
      }
      if (!cache.has(key)) materialMaps(g, slice).catch(() => undefined);
    }
  });
}
export function getMaterialMaps(g: MapGeometry): Promise<MaterialMaps> {
  return materialMaps(g);
}
/** Internal surface path; public map requests still return the exact geometry. */
export function getSurfaceMaterialMaps(g: MapGeometry): Promise<MaterialMaps> {
  const capsule = capsuleMapGeometry(g);
  return capsule ? materialMaps(capsule, true) : materialMaps(g, false);
}
/** Maps for a surface available without waiting a task: already shown, or
 * stored from an earlier load. Stored maps are handed out before their images
 * are decoded; a filter image resolves a `data:` URL in the frame it is
 * referenced, and decoding continues in the background for later swaps. */
export function peekSurfaceMaterialMaps(g: MapGeometry): MaterialMaps | undefined {
  const capsule = capsuleMapGeometry(g);
  return peek(capsule ?? g, Boolean(capsule));
}
export function peekMaterialMaps(g: MapGeometry): MaterialMaps | undefined {
  return peek(g, false);
}
function peek(g: MapGeometry, sliceCapsule: boolean): MaterialMaps | undefined {
  const key = keyOf(g, sliceCapsule);
  const shown = settled.get(key);
  if (shown) return shown;
  if (cache.has(key)) return undefined;
  const stored = peekStoredMaps(`${version}|${key}`);
  if (!stored) return undefined;
  const maps = assemble(g, sliceCapsule, stored.planes, stored.duration);
  claimFirstPaint(`${version}|${key}`, stored);
  lastUse.set(maps, performance.now());
  settled.set(key, maps);
  const result = Promise.all(drawnMapUrls(maps).map(decode)).then(() => maps);
  cache.set(key, result);
  result.catch(() => undefined);
  evict();
  return maps;
}
const keyOf = (g: MapGeometry, sliceCapsule: boolean) =>
  JSON.stringify([
    g.width,
    g.height,
    g.radius,
    g.dpr,
    g.appearance,
    g.material,
    g.outline,
    sliceCapsule,
  ]);
const names: MapPlane[] = ["field", "rim", "light"];
function assemble(
  g: MapGeometry,
  sliceCapsule: boolean,
  encoded: string[][],
  duration: number,
): MaterialMaps {
  const caps = sliceCapsule ? 3 : 0;
  const planes = Object.fromEntries(
    names.map((name, index) => [name, encoded[index].slice(1, 1 + caps)]),
  ) as Record<MapPlane, [string, string, string]>;
  const cut = nineCut(g);
  const scale = mapScale(g);
  const tiles = Object.fromEntries(
    names.map((name, index) => [name, encoded[index].slice(1 + caps)]),
  ) as Record<MapPlane, string[]>;
  return {
    field: encoded[0][0],
    rim: encoded[1][0],
    light: encoded[2][0],
    duration,
    ...(sliceCapsule ? { capsule: { cap: g.height + 2, height: g.height + 4, planes } } : {}),
    ...(cut && tiles.field.length === 9
      ? { nine: { x: cut.x / scale, y: cut.y / scale, planes: tiles } }
      : {}),
  };
}
function materialMaps(g: MapGeometry, sliceCapsule = false): Promise<MaterialMaps> {
  const key = keyOf(g, sliceCapsule);
  const cached = cache.get(key);
  if (cached) return cached;
  const stored = `${version}|${key}`;
  const result = loadStoredMaps(stored)
    .then(async (found) => {
      if (found) {
        claimFirstPaint(stored, found);
        return assemble(g, sliceCapsule, found.planes, found.duration);
      }
      const renderer = await getMaterialRenderer();
      const { width, height, pixels, duration } = await renderer.render(g);
      const encoded = await encodeMaterialPixels(
        pixels,
        width,
        height,
        sliceCapsule ? Math.round((g.height + 2) * mapScale(g)) : undefined,
        nineCut(g),
      );
      saveStoredMaps(stored, { planes: encoded, duration });
      claimFirstPaint(stored, { planes: encoded, duration });
      return assemble(g, sliceCapsule, encoded, duration);
    })
    .then(async (maps) => {
      // Only hand out maps whose image is decoded: switching a filter to it
      // then draws in the same frame instead of leaving the material blank.
      await Promise.all(drawnMapUrls(maps).map(decode));
      lastUse.set(maps, performance.now());
      if (cache.get(key) === result) settled.set(key, maps);
      return maps;
    })
    .catch((e) => {
      cache.delete(key);
      throw e;
    });
  cache.set(key, result);
  evict();
  return result;
}
/** Decoded images, kept alive while their maps are cached. */
const decoded = new Map<string, HTMLImageElement>();
export async function decode(url: string): Promise<void> {
  if (decoded.has(url) || typeof Image === "undefined") return;
  const image = new Image();
  image.src = url;
  await image.decode();
  decoded.set(url, image);
}
const lastUse = new WeakMap<MaterialMaps, number>();
const settled = new Map<string, MaterialMaps>();
/** Record that maps were drawn, so eviction never releases images on screen. */
export function touchMaps(maps: MaterialMaps): void {
  lastUse.set(maps, performance.now());
}
/** Every image of a set of maps. */
const urls = (maps: MaterialMaps) => [
  maps.field,
  maps.rim,
  maps.light,
  ...Object.values(maps.capsule?.planes ?? {}).flat(),
  ...Object.values(maps.nine?.planes ?? {}).flat(),
];
/** The images glass draws from a set of maps, which are decoded and warmed
 * before it shows: Chromium's backdrop glass draws only the nine tiles. */
export function drawnMapUrls(maps: MaterialMaps): string[] {
  if (chromium && maps.nine) return Object.values(maps.nine.planes).flat();
  return [maps.field, maps.rim, maps.light, ...Object.values(maps.capsule?.planes ?? {}).flat()];
}
function release(maps: MaterialMaps) {
  for (const url of urls(maps)) {
    releaseMapToken(url);
    decoded.delete(url);
  }
}
/** Decoded pixels a set of maps holds in memory, in bytes. */
const weight = (maps: MaterialMaps) =>
  urls(maps).reduce((bytes, url) => {
    const image = decoded.get(url);
    return bytes + (image ? image.naturalWidth * image.naturalHeight * 4 : 0);
  }, 0);
const cacheEntries = 64,
  cacheBytes = 96 * 1024 * 1024;
/** Drop the oldest maps that have not been drawn for 10s, while the cache
 * holds more entries or more decoded pixels than its budget. A count alone
 * lets a resized panel keep hundreds of megabytes of large maps. */
function evict() {
  const now = performance.now();
  let bytes = 0;
  for (const maps of settled.values()) bytes += weight(maps);
  for (const [key, maps] of settled) {
    if (cache.size <= cacheEntries && bytes <= cacheBytes) break;
    if (now - (lastUse.get(maps) ?? 0) < 10_000) continue;
    bytes -= weight(maps);
    cache.delete(key);
    settled.delete(key);
    release(maps);
  }
}
export function clearMaterialMapCache(): void {
  const now = performance.now();
  // Maps drawn recently may still be on screen; let them be collected with their URLs.
  for (const maps of settled.values()) if (now - (lastUse.get(maps) ?? 0) >= 10_000) release(maps);
  settled.clear();
  cache.clear();
}
