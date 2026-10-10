import { encodeMaterialPixels } from "./map-encoder.js";
import { getMaterialRenderer, materialShader, mapScale } from "../gpu/index.js";
import type { MapGeometry } from "../gpu/index.js";
import { capsuleMapGeometry, releaseMapToken } from "./map-image.js";
import type { MapPlane } from "./map-image.js";
import { claimFirstPaint, loadStoredMaps, peekStoredMaps, preloadStoredMaps, preloadedKeys, saveStoredMaps } from "./map-store.js";
export interface MaterialMaps {
  /** Displacement in red and green, shape coverage in alpha. */
  field: string;
  /** Rim shade with the highlight over it. */
  overlay: string;
  duration: number;
  /** Capsule maps reused at any width: CSS cap width, plane height, and slices. */
  capsule?: {
    cap: number;
    height: number;
    planes: Record<MapPlane, [string, string, string]>;
  };
}
/** Stored maps are only valid for the shader and encoder that produced them. */
const version = (() => {
  let hash = 2166136261;
  for (const char of `${materialShader.wgsl}|png-sub-2`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
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
        const [width, height, radius, dpr, appearance, outline, sliceCapsule] = JSON.parse(key) as [number, number, MapGeometry["radius"], number, MapGeometry["appearance"], MapGeometry["outline"], boolean];
        g = { width, height, radius, dpr, appearance, outline }; slice = sliceCapsule;
      } catch { continue; }
      if (!cache.has(key)) materialMaps(g, slice).catch(() => undefined);
    }
  });
}
export function getMaterialMaps(g: MapGeometry): Promise<MaterialMaps> {
  return materialMaps(g);
}
/** Internal surface path; public map requests still return the exact geometry.
 * Shapes an animation merely passes through are not worth keeping across
 * loads: with `persist` false they are rendered at once and never wait on the
 * store, whose startup read can take longer than the animation. */
export function getSurfaceMaterialMaps(g: MapGeometry, persist = true): Promise<MaterialMaps> {
  const capsule = capsuleMapGeometry(g);
  return capsule ? materialMaps(capsule, true, persist) : materialMaps(g, false, persist);
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
  const result = Promise.all(urls(maps).map(decode)).then(() => maps);
  cache.set(key, result);
  result.catch(() => undefined);
  evict();
  return maps;
}
const keyOf = (g: MapGeometry, sliceCapsule: boolean) =>
  JSON.stringify([g.width, g.height, g.radius, g.dpr, g.appearance, g.outline, sliceCapsule]);
const names: MapPlane[] = ["field", "overlay"];
function assemble(g: MapGeometry, sliceCapsule: boolean, encoded: string[][], duration: number): MaterialMaps {
  const planes = Object.fromEntries(names.map((name, index) => [name, encoded[index]!.slice(1)])) as Record<MapPlane, [string, string, string]>;
  return {
    field: encoded[0]![0]!,
    overlay: encoded[1]![0]!,
    duration,
    ...(sliceCapsule ? { capsule: { cap: g.height + 2, height: g.height + 4, planes } } : {}),
  };
}
function materialMaps(g: MapGeometry, sliceCapsule = false, persist = true): Promise<MaterialMaps> {
  const key = keyOf(g, sliceCapsule);
  const cached = cache.get(key);
  if (cached) return cached;
  const stored = `${version}|${key}`;
  const result = (persist ? loadStoredMaps(stored) : Promise.resolve(peekStoredMaps(stored)))
    .then(async (found) => {
      if (found) { claimFirstPaint(stored, found); return assemble(g, sliceCapsule, found.planes, found.duration); }
      const renderer = await getMaterialRenderer();
      const { width, height, pixels, duration } = await renderer.render(g);
      const encoded = await encodeMaterialPixels(pixels, width, height, sliceCapsule ? Math.round((g.height + 2) * mapScale(g)) : undefined);
      if (persist) {
        saveStoredMaps(stored, { planes: encoded, duration });
        claimFirstPaint(stored, { planes: encoded, duration });
      }
      return assemble(g, sliceCapsule, encoded, duration);
    })
    .then(async (maps) => {
      // Only hand out maps whose image is decoded: switching a filter to it
      // then draws in the same frame instead of leaving the material blank.
      await Promise.all(urls(maps).map(decode));
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
const urls = (maps: MaterialMaps) =>
  [maps.field, maps.overlay, ...Object.values(maps.capsule?.planes ?? {}).flat()];
function release(maps: MaterialMaps) {
  for (const url of urls(maps)) { releaseMapToken(url); decoded.delete(url); }
}
/** Drop the oldest maps beyond the cache size that have not been drawn for 10s. */
function evict() {
  const now = performance.now();
  for (const [key, maps] of settled) {
    if (cache.size <= 64) break;
    if (now - (lastUse.get(maps) ?? 0) < 10_000) continue;
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
