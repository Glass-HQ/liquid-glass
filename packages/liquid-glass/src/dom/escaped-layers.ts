import type { MaterialOptions } from "../core/materials.js";
import { materials } from "../core/materials.js";
import { animatesInCompositor, animatesPaint, mirrorable, scanCompositedLayers } from "./composited.js";
import { acquireRepaintLayer } from "./filter-paint-root.js";
import type { CompositedLayer, LayerBox, MirroredMedia } from "./composited.js";
import type { MediaMirrorPlan, MediaMirrors } from "./media-mirror.js";
import { refractionSamplingBounds } from "./sampling-bounds.js";

/** Glass over content that WebKit composites apart from the content's filter.
 * Loaded only in WebKit. See `composited.ts` for why such content escapes,
 * and `media-mirror.ts` for how video and canvas pixels are brought back. */

/** A lens as the scene measured it this frame, in the content's coordinates. */
export interface EscapeLens extends LayerBox {
  element: HTMLElement;
  options: MaterialOptions;
  /** Set while the outline animates between prepared shapes. */
  place?: unknown;
  /** The shape the lens shows; an outline makes its refraction asymmetric. */
  shown?: { outline?: unknown };
}

/** A composited layer that draws its own copy of the glass over it. */
export interface LayerGlass extends LayerBox { element: HTMLElement; scale: number }

export interface EscapePlan {
  layers: LayerGlass[];
  /** Whether the next frame must run, for an animation or a mirror still being placed. */
  busy: boolean;
  write: () => void;
}

export interface EscapedLayers {
  plan(content: HTMLElement | null, origin: DOMRect, lenses: readonly EscapeLens[], skip: readonly Element[], now: number, structure: number, blur: (lens: EscapeLens) => number): EscapePlan;
  /** Whether a mutation is this module's own output. */
  owns(node: Node, record: MutationRecord): boolean;
  dispose(): void;
}

const intersects = (a: LayerBox, b: LayerBox, margin = 0) =>
  a.x - margin < b.x + b.w && b.x - margin < a.x + a.w && a.y - margin < b.y + b.h && b.y - margin < a.y + a.h;

/** The part of a box inside `width` × `height`, if any. */
const clip = (box: LayerBox, width: number, height: number): LayerBox | undefined => {
  const x = Math.max(0, box.x), y = Math.max(0, box.y);
  const w = Math.min(width, box.x + box.w) - x, h = Math.min(height, box.y + box.h) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : undefined;
};

export function createEscapedLayers(wake: () => void): EscapedLayers {
  /** Mirrors load with the first video or canvas under glass. */
  let mirrors: MediaMirrors | undefined;
  let mirrorsRequested = false, disposed = false;
  const loadMirrors = () => {
    if (mirrorsRequested) return;
    mirrorsRequested = true;
    import("./media-mirror.js").then(({ createMediaMirrors }) => {
      if (disposed) return;
      mirrors = createMediaMirrors(wake);
      wake();
    }, () => undefined);
  };
  /** Media whose clip the mirrors write. */
  const holed = new WeakSet<Node>();
  const animationKinds = new WeakMap<Animation, { compositor: boolean; paint: boolean }>();
  /** Elements given a layer while a paint animation runs, and their release. */
  const repainting = new Map<HTMLElement, () => void>();
  let composited: CompositedLayer[] = [];
  let scannedAt = -Infinity, scannedStructure = -1;

  /** Elements with running animations: those WebKit runs in its compositor,
   * and those it repaints every frame. */
  const animated = (content: HTMLElement) => {
    const compositor = new Set<HTMLElement>(), paint = new Set<HTMLElement>();
    if (typeof content.getAnimations !== "function") return { compositor, paint };
    for (const animation of content.getAnimations({ subtree: true })) {
      if (animation.playState !== "running") continue;
      const effect = animation.effect;
      const target = effect instanceof KeyframeEffect ? effect.target : null;
      if (!(target instanceof HTMLElement) || target === content) continue;
      let kind = animationKinds.get(animation);
      if (!kind) {
        const properties = new Set<string>();
        if ("transitionProperty" in animation) properties.add(String((animation as { transitionProperty: string }).transitionProperty));
        for (const frame of (effect as KeyframeEffect).getKeyframes())
          for (const name of Object.keys(frame)) properties.add(name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`));
        // A short transition is over before a new layer would pay off.
        const active = Number((effect as KeyframeEffect).getComputedTiming().activeDuration ?? 0);
        kind = { compositor: animatesInCompositor(properties), paint: animatesPaint(properties) && !(active < 1000) };
        animationKinds.set(animation, kind);
      }
      if (kind.compositor) compositor.add(target);
      if (kind.paint) paint.add(target);
    }
    return { compositor, paint };
  };

  /** A layer of its own changes stacking for positioned descendants, so only
   * elements without any are promoted. */
  const promotable = (element: HTMLElement) => {
    if (element.localName === "video" || element.localName === "canvas") return false;
    const view = element.ownerDocument.defaultView ?? window;
    let checked = 0;
    for (const child of element.querySelectorAll("*")) {
      if (++checked > 64) return false;
      if (view.getComputedStyle(child).position !== "static") return false;
    }
    return true;
  };

  return {
    plan(content, origin, lenses, skip, now, structure, blur) {
      const plans = new Map<MirroredMedia, MediaMirrorPlan>();
      const layers: LayerGlass[] = [];
      let busy = false;
      let promotions = new Set<HTMLElement>();
      const write = () => {
        mirrors?.update(plans);
        for (const [element, release] of repainting) if (!promotions.has(element) || !element.isConnected) { release(); repainting.delete(element); }
        for (const element of promotions) if (!repainting.has(element)) repainting.set(element, acquireRepaintLayer(element));
      };
      if (!content || !lenses.length) return { layers, busy, write };
      // A full scan reads every element's style, so it follows DOM changes at
      // most four times a second; running animations are read every frame.
      if ((scannedStructure !== structure && now - scannedAt > 250) || now - scannedAt > 1000) {
        composited = scanCompositedLayers(content, (element) => Boolean(mirrors?.ownsCanvas(element)) || skip.includes(element));
        scannedAt = now;
        scannedStructure = structure;
      }
      const candidates = new Map(composited.map((layer) => [layer.element, layer.reason]));
      const running = animated(content);
      for (const element of running.compositor) if (!candidates.has(element)) {
        candidates.set(element, element.localName === "video" || element.localName === "canvas" ? "media" : "layer");
        busy = true;
      }
      // Painted animations take a layer of their own, then glass like one.
      const promote = new Set<HTMLElement>();
      for (const element of running.paint) {
        if (!repainting.has(element) && !promotable(element)) continue;
        promote.add(element);
        if (!candidates.has(element)) candidates.set(element, "layer");
      }
      promotions = promote;
      const refraction = (l: EscapeLens) => l.options.refraction ?? materials[l.options.material ?? "clear"].refraction;
      for (const [element, reason] of candidates) {
        if (!element.isConnected || !content.contains(element)) continue;
        const rect = element.getBoundingClientRect();
        if (!rect.width || !rect.height) continue;
        const box: LayerBox = { x: rect.left - origin.left, y: rect.top - origin.top, w: rect.width, h: rect.height };
        const over = lenses.filter((l) => intersects(box, l, Math.ceil(3 * blur(l) + refraction(l) + 10)) && !element.contains(l.element) && !l.element.contains(element));
        if (!over.length) continue;
        const scale = element.offsetWidth ? rect.width / element.offsetWidth : 1;
        if (reason === "media" && mirrorable(element) && !mirrors) { loadMirrors(); busy = true; }
        else if (reason === "media" && mirrorable(element) && mirrors) {
          // Each tile covers what one lens samples, merged where they meet;
          // holes in the media show the glass.
          const local = (x: number, y: number, w: number, h: number): LayerBox => ({ x: (x - box.x) / scale, y: (y - box.y) / scale, w: w / scale, h: h / scale });
          const regions: LayerBox[] = [];
          for (const l of over) {
            const sampled = refractionSamplingBounds({ x: l.x - 2, y: l.y - 2, width: l.w + 4, height: l.h + 4 }, refraction(l), !l.place && Boolean(l.shown && !l.shown.outline));
            const spread = Math.ceil(3 * blur(l)) + 2;
            let region = clip(local(sampled.x - spread, sampled.y - spread, sampled.width + 2 * spread, sampled.height + 2 * spread), element.offsetWidth, element.offsetHeight);
            if (!region) continue;
            for (let index = regions.length - 1; index >= 0; index--) {
              const other = regions[index]!;
              if (!intersects(region, other)) continue;
              const x = Math.min(region.x, other.x), y = Math.min(region.y, other.y);
              region = { x, y, w: Math.max(region.x + region.w, other.x + other.w) - x, h: Math.max(region.y + region.h, other.y + other.h) - y };
              regions.splice(index, 1);
            }
            regions.push(region);
          }
          if (!regions.length) continue;
          const holes = over.map((l) => ({ ...local(l.x - 1, l.y - 1, l.w + 2, l.h + 2), radius: (parseFloat(l.element.style.getPropertyValue("--lg-radius")) || 0) / scale }));
          const tiles = mirrors.canvasesOf(element);
          const measured = tiles.map((tile) => {
            const placed = tile.getBoundingClientRect();
            return { x: (placed.left - rect.left) / scale, y: (placed.top - rect.top) / scale };
          });
          plans.set(element, { regions, holes, measured });
          holed.add(element);
          // Each tile carries the glass over the media on itself.
          const shown = mirrors.whole(element) ? [{ x: 0, y: 0, w: element.offsetWidth, h: element.offsetHeight }] : regions;
          if (tiles.length < shown.length) busy = true;
          tiles.forEach((tile, index) => {
            const region = shown[index];
            if (region) layers.push({ element: tile, x: box.x + region.x * scale, y: box.y + region.y * scale, w: region.w * scale, h: region.h * scale, scale });
          });
        } else if (reason === "layer") {
          // Filters cannot turn the glass's maps, so a rotated or skewed
          // layer keeps the glass of its content only.
          const transform = getComputedStyle(element).transform;
          if (transform !== "none") { const m = new DOMMatrixReadOnly(transform); if (Math.abs(m.b) > 1e-4 || Math.abs(m.c) > 1e-4) continue; }
          layers.push({ element, ...box, scale });
        }
      }
      if (mirrors?.animating()) busy = true;
      return { layers, busy, write };
    },
    owns(node, record) {
      if (mirrors?.ownsCanvas(node)) return true;
      if (record.type === "attributes") return record.attributeName === "style" && (holed.has(node) || repainting.has(node as HTMLElement));
      const changed = [...record.addedNodes, ...record.removedNodes];
      return changed.length > 0 && changed.every((child) => Boolean(mirrors?.ownsCanvas(child)));
    },
    dispose() {
      disposed = true;
      mirrors?.dispose();
      for (const release of repainting.values()) release();
      repainting.clear();
    },
  };
}
