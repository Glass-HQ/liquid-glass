import { materials } from "../core/materials.js";
import type { MaterialOptions } from "../core/materials.js";
import { patchFilters } from "./filter-patch.js";
import { blendMapImage } from "./map-blend.js";
import type { PlacedMap } from "./map-blend.js";
import { mapImage, mapUrl } from "./map-image.js";
import type { MapPlane } from "./map-image.js";
import type { MaterialMaps } from "./maps.js";
import { frostMarkup, overlayTintMarkup, tintChannels, tintMarkup, toneMarkup } from "./material-graph.js";
import { progressiveGraph } from "./progressive.js";
import type { ProgressiveRegion } from "./progressive.js";

/** A surface's border box on screen and the scale its transforms apply. */
export interface LayerFrame { left: number; top: number; sx: number; sy: number; clientLeft: number; clientTop: number }
export interface LayerLens {
  serial: number;
  element: HTMLElement;
  options: MaterialOptions;
  maps: MaterialMaps;
  /** Prepared shapes blended in motion, in content coordinates. */
  place?: { a: PlacedMap; b: PlacedMap; mix: number };
  /** Drawn glass in content coordinates. */
  x: number; y: number; w: number; h: number;
  opacity: number;
  /** Displacement travel in CSS pixels. */
  refraction: number;
  /** Glass this surface sits inside, innermost first. */
  parents: readonly LayerLens[];
  /** Earlier glass, not an ancestor, close enough to be refracted. */
  beneath: readonly LayerLens[];
  frame: LayerFrame;
}
interface Box { left: number; top: number; width: number; height: number }
interface Layer {
  element: HTMLDivElement;
  host: HTMLElement;
  base: string;
  /** Inline isolation as authored, restored when the layer leaves. */
  isolation: string;
  written: Map<string, string>;
  /** The layer's box on screen this frame. */
  screen?: Box;
}
let serial = 0;
const ns = "http://www.w3.org/2000/svg";
const voidElements = /^(area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/i;

/** Gecko renders an SVG filter with images or displacement in software and,
 * once it falls back, rasterizes it again on every paint of the page,
 * whatever changed. A filter over a whole content layer then costs its full
 * area on every frame of any animation anywhere.
 *
 * Here each surface draws its own glass instead. A layer inside the surface,
 * beneath its children, paints a live `-moz-element()` copy of the content
 * (and of the glass under it) and refracts only that. The content layer
 * itself stays unfiltered on the GPU. An unchanged layer is never
 * rasterized again, and a moving one costs only its own area. */
export function createLensLayers(root: HTMLElement) {
  const owner = ++serial;
  const document = root.ownerDocument;
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.style.position = "absolute";
  svg.style.pointerEvents = "none";
  const defs = document.createElementNS(ns, "defs");
  svg.append(defs);
  // Outside every surface and content layer, so no layer references itself.
  document.body.append(svg);
  const layers = new Map<number, Layer>();
  let contentId: { element: HTMLElement; original: string | null; id: string } | undefined;

  const write = (layer: Layer, name: string, value: string) => {
    if (layer.written.get(name) === value) return;
    layer.written.set(name, value);
    layer.element.style.setProperty(name, value);
  };
  const release = (key: number, layer: Layer) => {
    layer.element.remove();
    if (layer.isolation) layer.host.style.isolation = layer.isolation;
    else layer.host.style.removeProperty("isolation");
    layers.delete(key);
  };
  const reference = (element: HTMLElement) => `-moz-element(#${CSS.escape(element.id)})`;

  return {
    /** `blur` is the scene's progressive blur when it is drawn on a host
     * around the content rather than on the content: layers then blur their
     * own copy of the content the same way, so they never render the whole
     * blurred content to sample a small part of it. */
    update(lenses: readonly LayerLens[], content: HTMLElement, contentRect: Box, blur?: { left: number; top: number; regions: readonly ProgressiveRegion[] }) {
      if (contentId?.element !== content) {
        if (contentId) restoreContentId();
        contentId = { element: content, original: content.getAttribute("id"), id: content.id || `lg-content-${owner}` };
        if (!content.id) content.id = contentId.id;
      }
      const keep = new Set<number>();
      const markup: string[] = [];
      const plans: { lens: LayerLens; layer: Layer; screen: Box; local: Box; lens_: Box }[] = [];
      for (const lens of lenses) {
        if (voidElements.test(lens.element.tagName)) continue;
        keep.add(lens.serial);
        let layer = layers.get(lens.serial);
        if (layer && layer.host !== lens.element) { release(lens.serial, layer); layer = undefined; }
        if (!layer) {
          const element = document.createElement("div");
          element.className = "lg-glass-layer";
          element.setAttribute("aria-hidden", "true");
          element.id = `lg-layer-${owner}-${lens.serial}`;
          layer = { element, host: lens.element, base: `lg-lens-${owner}-${lens.serial}`, isolation: lens.element.style.isolation, written: new Map() };
          // A stacking context keeps the layer above the surface's own
          // background and below its children.
          lens.element.style.isolation = "isolate";
          lens.element.append(element);
          layers.set(lens.serial, layer);
        }
        const o = lens.options;
        const f = lens.frame;
        // Sampling reach around the glass: blur and the largest displacement.
        const blur = o.material === "regular"
          ? Math.max(materials.regular.blur, (o.appearance === "dark" ? materials.regular.dark : materials.regular.light).fillSigma) : 0;
        const margin = Math.ceil(3 * blur + lens.refraction + 4);
        const glass = { left: contentRect.left + lens.x - 2, top: contentRect.top + lens.y - 2, width: lens.w + 4, height: lens.h + 4 };
        const screen = { left: glass.left - margin, top: glass.top - margin, width: glass.width + 2 * margin, height: glass.height + 2 * margin };
        layer.screen = screen;
        // The layer lives in the surface's untransformed space.
        const local = {
          left: (screen.left - f.left) / f.sx - f.clientLeft, top: (screen.top - f.top) / f.sy - f.clientTop,
          width: screen.width / f.sx, height: screen.height / f.sy,
        };
        const lens_ = { left: margin / f.sx, top: margin / f.sy, width: glass.width / f.sx, height: glass.height / f.sy };
        plans.push({ lens, layer, screen, local, lens_ });
      }
      for (const [key, layer] of layers) if (!keep.has(key)) release(key, layer);
      for (const { lens, layer, screen, local, lens_ } of plans) {
        const f = lens.frame, o = lens.options, p = "l";
        const toLayer = (left: number, top: number) => [(left - screen.left) / f.sx, (top - screen.top) / f.sy] as const;
        // Glass beneath first in paint order, the content last: CSS draws
        // its first background on top.
        const sources: { image: string; box: Box }[] = [];
        for (const below of [...lens.parents, ...[...lens.beneath].reverse()]) {
          const other = layers.get(below.serial);
          if (other?.screen && other !== layer) sources.push({ image: reference(other.element), box: other.screen });
        }
        // Glass inside opaque glass that encloses it sees only that glass.
        // Every -moz-element() source renders its whole element, so skipping
        // the content saves a full render of it whenever the content changes.
        const parent = lens.parents[0], enclosing = parent && layers.get(parent.serial)?.screen;
        const covered = parent && enclosing && parent.opacity >= 0.999 &&
          enclosing.left <= screen.left && enclosing.top <= screen.top &&
          enclosing.left + enclosing.width >= screen.left + screen.width && enclosing.top + enclosing.height >= screen.top + screen.height;
        if (!covered) sources.push({ image: reference(content), box: contentRect });
        // The progressive blur the content shows on screen, in this layer's space.
        const regions = covered || !blur ? [] : blur.regions.flatMap((r) => {
          const [x, y] = toLayer(contentRect.left + blur.left + r.x, contentRect.top + blur.top + r.y);
          const mapped = { ...r, x, y, width: r.width / f.sx, height: r.height / f.sy, blur: r.blur / Math.max(f.sx, f.sy), refraction: r.refraction / Math.max(f.sx, f.sy) };
          const reach = 3 * mapped.blur + mapped.refraction;
          return mapped.x < local.width + reach && mapped.x + mapped.width > -reach && mapped.y < local.height + reach && mapped.y + mapped.height > -reach ? [mapped] : [];
        });
        if (regions.length) markup.push(progressiveGraph(`${layer.base}-blur`, regions, local.width, local.height, "gecko"));
        write(layer, "left", `${local.left}px`);
        write(layer, "top", `${local.top}px`);
        write(layer, "width", `${local.width}px`);
        write(layer, "height", `${local.height}px`);
        write(layer, "opacity", String(Math.round(lens.opacity * 1000) / 1000));
        write(layer, "background-image", sources.map((s) => s.image).join(", "));
        write(layer, "background-position", sources.map((s) => { const [x, y] = toLayer(s.box.left, s.box.top); return `${x}px ${y}px`; }).join(", "));
        write(layer, "background-size", sources.map((s) => `${s.box.width / f.sx}px ${s.box.height / f.sy}px`).join(", "));
        const region = `x="${lens_.left}" y="${lens_.top}" width="${lens_.width}" height="${lens_.height}"`;
        const image = (plane: MapPlane, result: string) => {
          if (!lens.place) return mapImage(lens.maps, plane, result, lens_.left, lens_.top, lens_.width, lens_.height);
          const placed = (m: PlacedMap): PlacedMap => {
            const [x, y] = toLayer(contentRect.left + m.x, contentRect.top + m.y);
            return { maps: m.maps, x, y, w: m.w / f.sx, h: m.h / f.sy };
          };
          const [x, y] = toLayer(contentRect.left + lens.x, contentRect.top + lens.y);
          return blendMapImage(plane, result, { a: placed(lens.place.a), b: placed(lens.place.b), mix: lens.place.mix }, { x, y, w: lens.w / f.sx, h: lens.h / f.sy });
        };
        const scale = Math.max(f.sx, f.sy);
        let base = "SourceGraphic";
        const parts = [image("field", `${p}field`)];
        if (o.material === "regular") {
          const frost = frostMarkup(p, base, o, 1 / scale);
          parts.push(frost.markup);
          base = frost.result;
        }
        parts.push(
          `<feDisplacementMap in="${base}" in2="${p}field" scale="${2 * lens.refraction / scale}" xChannelSelector="R" yChannelSelector="G" ${region} result="${p}refracted"/>`,
          toneMarkup(p, o, lens.parents.length > 0),
        );
        let color = `${p}color`, overlay = `${p}overlay`;
        const tint = tintChannels(o);
        if (tint) { const tinted = tintMarkup(p, o, tint); parts.push(tinted.markup); color = tinted.color; overlay = `${p}tintOverlay`; }
        parts.push(
          `<feComposite in="${color}" in2="${p}field" operator="in" ${region} result="${p}inside"/>`,
          image("overlay", `${p}overlay`),
          ...(tint ? [overlayTintMarkup(`${p}overlay`, overlay, o, tint)] : []),
          `<feMerge ${region} result="${p}glass"><feMergeNode in="${p}inside"/><feMergeNode in="${overlay}"/></feMerge>`,
        );
        // Pointwise passes only need the glass; the tone tables otherwise
        // run over the whole sampled neighborhood.
        const graph = parts.join("").replace(/<(feComponentTransfer|feColorMatrix)\b(?![^>]*\sx=")([^>]*?)(\/?)>/g, `<$1$2 ${region}$3>`);
        markup.push(`<filter id="${layer.base}" x="0" y="0" width="1" height="1" filterUnits="objectBoundingBox" primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB">${graph}</filter>`);
      }
      const live = patchFilters(defs, markup, mapUrl);
      const blurred = new Set(markup.map((m) => /id="([^"]+)"/.exec(m)![1]));
      for (const { layer } of plans) {
        const id = `${layer.base}-blur`;
        write(layer, "filter", [blurred.has(id) ? `url("#${live(id)}")` : "", `url("#${live(layer.base)}")`].filter(Boolean).join(" "));
      }
    },
    owns(node: Node): boolean {
      if (svg.contains(node)) return true;
      for (const layer of layers.values()) if (layer.element.contains(node)) return true;
      return false;
    },
    dispose() {
      for (const [key, layer] of layers) release(key, layer);
      svg.remove();
      restoreContentId();
    },
  };
  function restoreContentId() {
    if (!contentId) return;
    const { element, original, id } = contentId;
    if (element.id === id && original === null) element.removeAttribute("id");
    contentId = undefined;
  }
}
