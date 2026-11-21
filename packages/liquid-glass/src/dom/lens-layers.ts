import { aberrationFor, glassRecipe, glassSize, outlineFor } from "../core/materials.js";
import type { MaterialOptions } from "../core/materials.js";
import { patchFilters } from "./filter-patch.js";
import { mapImage, mapUrl } from "./map-image.js";
import type { MapPlane } from "./map-image.js";
import type { MaterialMaps } from "./maps.js";
import { touchMaps } from "./maps.js";
import {
  backdropColor,
  fillMarkup,
  frostMarkup,
  lightMarkup,
  outlineMarkup,
  overlayTintMarkup,
  refractMarkup,
  tintChannels,
  tintMarkup,
  toneMarkup,
} from "./material-graph.js";
import { progressiveGraph } from "./progressive.js";
import type { ProgressiveRegion } from "./progressive.js";

/** A surface's border box on screen and the scale its transforms apply. */
export interface LayerFrame {
  left: number;
  top: number;
  sx: number;
  sy: number;
  clientLeft: number;
  clientTop: number;
}
/** How a surface's layer gets what is behind it. `copy` paints a live
 * `-moz-element()` view of the content and refracts it: Gecko, for glass
 * beside the content. `backdrop` filters the surface's own backdrop with the
 * material on the GPU, without refraction: Gecko, for glass inside the
 * content, which a copy of the content would show its own face. `flat` gives
 * the glass a body of the backdrop color: WebKit, for glass inside the
 * content, which WebKit cannot filter from beneath. */
export type LayerMode = "copy" | "backdrop" | "flat";
export interface LayerLens {
  serial: number;
  mode: LayerMode;
  element: HTMLElement;
  options: MaterialOptions;
  maps: MaterialMaps;
  /** Drawn glass in content coordinates. */
  x: number;
  y: number;
  w: number;
  h: number;
  opacity: number;
  /** Displacement travel in CSS pixels. */
  refraction: number;
  /** Glass this surface sits inside, innermost first. */
  parents: readonly LayerLens[];
  /** Earlier glass, not an ancestor, close enough to be refracted. */
  beneath: readonly LayerLens[];
  frame: LayerFrame;
}
interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}
/** `glass` holds the material over a plain copy of the backdrop (`source`)
 * and its refracted copy; `light` adds the rim's light to it, and `rim` holds
 * the outline just outside it. */
type Part = "glass" | "source" | "refracted" | "light" | "rim";
interface Layer {
  element: HTMLDivElement;
  host: HTMLElement;
  base: string;
  /** Inline isolation as authored, restored when the layer leaves. */
  isolation: string;
  written: Map<string, string>;
  /** Children of a layer whose frost runs on the GPU: the material over
   * the backdrop and a refracted copy of it, and the rim and light above. */
  split?: Record<Part, HTMLDivElement>;
  /** The layer's box on screen this frame. */
  screen?: Box;
  mode?: LayerMode;
  /** The host's inline backdrop filter as authored, while the layer filters
   * the host's backdrop. */
  backdrop?: { value: string; priority: string };
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
export type LensLayers = ReturnType<typeof createLensLayers>;
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

  const write = (layer: Layer, name: string, value: string, part?: Part) => {
    const key = part ? `${part} ${name}` : name;
    if (layer.written.get(key) === value) return;
    layer.written.set(key, value);
    (part ? layer.split![part] : layer.element).style.setProperty(name, value);
  };
  const splitOf = (layer: Layer) => {
    if (layer.split) return layer.split;
    const names: Part[] = ["glass", "source", "refracted", "light", "rim"];
    const parts = Object.fromEntries(
      names.map((name) => {
        const element = document.createElement("div");
        Object.assign(element.style, {
          position: "absolute",
          inset: "0",
          pointerEvents: "none",
          backgroundRepeat: "no-repeat",
          maskRepeat: "no-repeat",
        });
        return [name, element];
      }),
    ) as Record<Part, HTMLDivElement>;
    parts.refracted.style.inset = "auto";
    // Light adds to the glass beneath it, as it does on macOS.
    parts.light.style.mixBlendMode = "plus-lighter";
    parts.glass.append(parts.source, parts.refracted);
    layer.element.append(parts.glass, parts.light, parts.rim);
    return (layer.split = parts);
  };
  /** The images of one map plane across a box: one, or the two caps and the
   * stretched middle of a capsule, listed topmost first as CSS paints them. */
  const planeImages = (maps: MaterialMaps, plane: MapPlane, box: Box) => {
    touchMaps(maps);
    const slices = maps.capsule;
    const cap = slices ? (slices.cap * box.height) / slices.height : 0;
    if (!slices || box.width < cap * 2)
      return [{ url: maps[plane], left: box.left, width: box.width }];
    const [left, middle, right] = slices.planes[plane];
    return [
      { url: right, left: box.left + box.width - cap, width: cap },
      { url: left, left: box.left, width: cap },
      { url: middle, left: box.left + cap - 0.5, width: box.width - cap * 2 + 1 },
    ];
  };
  const restoreBackdrop = (layer: Layer) => {
    const original = layer.backdrop;
    if (!original) return;
    layer.backdrop = undefined;
    if (original.value)
      layer.host.style.setProperty("backdrop-filter", original.value, original.priority);
    else layer.host.style.removeProperty("backdrop-filter");
  };
  const release = (key: number, layer: Layer) => {
    restoreBackdrop(layer);
    layer.element.remove();
    if (layer.isolation) layer.host.style.isolation = layer.isolation;
    else layer.host.style.removeProperty("isolation");
    layers.delete(key);
  };
  const reference = (element: HTMLElement) => `-moz-element(#${CSS.escape(element.id)})`;
  type Images = ReturnType<typeof planeImages>;
  /** Paint map images over a box as a part's mask or background. */
  const paintImages = (
    layer: Layer,
    part: Part | undefined,
    property: "mask" | "background",
    images: Images,
    box: Box,
  ) => {
    write(
      layer,
      `${property}-image`,
      images.length ? images.map((i) => `url("${i.url}")`).join(", ") : "none",
      part,
    );
    write(
      layer,
      `${property}-position`,
      images.map((i) => `${i.left}px ${box.top}px`).join(", "),
      part,
    );
    write(
      layer,
      `${property}-size`,
      images.map((i) => `${i.width}px ${box.height}px`).join(", "),
      part,
    );
  };
  const filterOpen = (id: string) =>
    `<filter id="${id}" x="0" y="0" width="1" height="1" filterUnits="objectBoundingBox" primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB">`;
  /** Glass drawn in the surface's own box, from what is behind it rather
   * than a copy of the content: the material as a filter, the rim and light
   * as the overlay map. `color` is the resolved backdrop color. */
  const drawOwn = (
    lens: LayerLens,
    layer: Layer,
    local: Box,
    box: Box,
    color: string,
  ): string[] => {
    const o = lens.options,
      f = lens.frame,
      p = "l";
    const tint = tintChannels(o);
    write(layer, "left", `${local.left}px`);
    write(layer, "top", `${local.top}px`);
    write(layer, "width", `${local.width}px`);
    write(layer, "height", `${local.height}px`);
    // The surface's own opacity fades the layer and the backdrop with it.
    write(layer, "opacity", "1");
    const size = glassSize(lens.options, lens.w, lens.h);
    const material = (input: string, frost: boolean) => {
      const parts: string[] = [];
      let base = input;
      if (frost) {
        const frosted = frostMarkup(p, base, o, size, 1 / Math.max(f.sx, f.sy));
        parts.push(frosted.markup);
        base = frosted.result;
        const filled = fillMarkup(p, base, input, o, size, 1 / Math.max(f.sx, f.sy));
        parts.push(filled.markup);
        base = filled.result;
      }
      parts.push(toneMarkup(p, o, size, base));
      if (tint) parts.push(tintMarkup(p, o, tint).markup);
      return parts.join("");
    };
    const markup: string[] = [];
    if (lens.mode === "backdrop") {
      // The host's own backdrop excludes its face. Its clip path keeps the
      // filtered backdrop to the shape.
      const backed = color
        ? `<feFlood flood-color="${color}" result="${p}back"/><feMerge result="${p}backed"><feMergeNode in="${p}back"/><feMergeNode in="SourceGraphic"/></feMerge>`
        : "";
      markup.push(
        `${filterOpen(`${layer.base}-backdrop`)}${backed}${material(color ? `${p}backed` : "SourceGraphic", true)}</filter>`,
      );
      paintImages(
        layer,
        undefined,
        "background",
        [...planeImages(lens.maps, "light", box), ...planeImages(lens.maps, "rim", box)],
        box,
      );
    } else {
      // A body of the backdrop color takes the material's tone; blurring a
      // single color changes nothing, so it is not frosted.
      splitOf(layer);
      write(layer, "display", "block", "glass");
      write(layer, "display", "none", "source");
      write(layer, "display", "none", "refracted");
      write(layer, "display", "block", "light");
      write(layer, "display", "block", "rim");
      write(layer, "background-color", backdropColor, "glass");
      paintImages(layer, "glass", "mask", planeImages(lens.maps, "field", box), box);
      paintImages(layer, "light", "background", planeImages(lens.maps, "light", box), box);
      paintImages(layer, "rim", "background", planeImages(lens.maps, "rim", box), box);
      markup.push(
        `${filterOpen(`${layer.base}-material`)}${material("SourceGraphic", false)}</filter>`,
      );
    }
    if (tint)
      markup.push(
        `${filterOpen(`${layer.base}-light`)}${overlayTintMarkup("SourceGraphic", `${p}light`, tint)}</filter>`,
      );
    return markup;
  };
  const applyOwn = (layer: Layer, live: (id: string) => string, defined: Set<string>) => {
    const url = (id: string) => `url("#${live(id)}")`;
    const light = defined.has(`${layer.base}-light`) ? url(`${layer.base}-light`) : "none";
    if (layer.mode === "flat") {
      write(layer, "filter", "none");
      write(layer, "filter", url(`${layer.base}-material`), "glass");
      write(layer, "filter", light, "light");
      return;
    }
    const host = layer.host.style;
    layer.backdrop ??= {
      value: host.getPropertyValue("backdrop-filter"),
      priority: host.getPropertyPriority("backdrop-filter"),
    };
    const value = url(`${layer.base}-backdrop`);
    if (host.getPropertyValue("backdrop-filter") !== value)
      host.setProperty("backdrop-filter", value);
    write(layer, "filter", light);
  };

  return {
    /** `blur` is the scene's progressive blur when it is drawn on a host
     * around the content rather than on the content: layers then blur their
     * own copy of the content the same way, so they never render the whole
     * blurred content to sample a small part of it. With `backdrop`, each
     * layer's copy lies over the scene's backdrop color, which a backdrop
     * filter receives resolved as `backdropColor`. */
    update(
      lenses: readonly LayerLens[],
      content: HTMLElement | null,
      contentRect: Box,
      blur?: { left: number; top: number; regions: readonly ProgressiveRegion[] },
      backdrop = false,
      resolvedBackdrop = "",
    ) {
      if (content && contentId?.element !== content) {
        if (contentId) restoreContentId();
        contentId = {
          element: content,
          original: content.getAttribute("id"),
          id: content.id || `lg-content-${owner}`,
        };
        if (!content.id) content.id = contentId.id;
      }
      const keep = new Set<number>();
      const markup: string[] = [];
      const plans: { lens: LayerLens; layer: Layer; screen: Box; local: Box; lens_: Box }[] = [];
      for (const lens of lenses) {
        if (voidElements.test(lens.element.tagName)) continue;
        keep.add(lens.serial);
        let layer = layers.get(lens.serial);
        // A surface moving into or out of the content starts a fresh layer.
        if (layer && (layer.host !== lens.element || layer.mode !== lens.mode)) {
          release(lens.serial, layer);
          layer = undefined;
        }
        if (!layer) {
          const element = document.createElement("div");
          element.className = "lg-glass-layer";
          element.setAttribute("aria-hidden", "true");
          element.id = `lg-layer-${owner}-${lens.serial}`;
          layer = {
            element,
            host: lens.element,
            base: `lg-lens-${owner}-${lens.serial}`,
            isolation: lens.element.style.isolation,
            written: new Map(),
            mode: lens.mode,
          };
          // A stacking context keeps the layer above the surface's own
          // background and below its children.
          lens.element.style.isolation = "isolate";
          lens.element.append(element);
          layers.set(lens.serial, layer);
        }
        const o = lens.options;
        const f = lens.frame;
        // Sampling reach around the glass: blur and the largest displacement.
        const recipe = glassRecipe(o, glassSize(lens.options, lens.w, lens.h));
        const blur = Math.max(recipe.blur, recipe.fill);
        // Only a copy samples around the glass; the others draw in its box.
        const margin = lens.mode === "copy" ? Math.ceil(3 * blur + lens.refraction + 4) : 0;
        const glass = {
          left: contentRect.left + lens.x - 2,
          top: contentRect.top + lens.y - 2,
          width: lens.w + 4,
          height: lens.h + 4,
        };
        const screen = {
          left: glass.left - margin,
          top: glass.top - margin,
          width: glass.width + 2 * margin,
          height: glass.height + 2 * margin,
        };
        layer.screen = screen;
        // The layer lives in the surface's untransformed space.
        const local = {
          left: (screen.left - f.left) / f.sx - f.clientLeft,
          top: (screen.top - f.top) / f.sy - f.clientTop,
          width: screen.width / f.sx,
          height: screen.height / f.sy,
        };
        const lens_ = {
          left: margin / f.sx,
          top: margin / f.sy,
          width: glass.width / f.sx,
          height: glass.height / f.sy,
        };
        plans.push({ lens, layer, screen, local, lens_ });
      }
      for (const [key, layer] of layers) if (!keep.has(key)) release(key, layer);
      for (const { lens, layer, screen, local, lens_ } of plans) {
        if (lens.mode !== "copy") {
          markup.push(...drawOwn(lens, layer, local, lens_, resolvedBackdrop));
          continue;
        }
        if (!content) continue;
        const f = lens.frame,
          o = lens.options,
          p = "l";
        const toLayer = (left: number, top: number) =>
          [(left - screen.left) / f.sx, (top - screen.top) / f.sy] as const;
        // Glass beneath first in paint order, the content last: CSS draws
        // its first background on top.
        const sources: { image: string; box: Box }[] = [];
        for (const below of [...lens.parents, ...[...lens.beneath].reverse()]) {
          const other = layers.get(below.serial);
          if (other?.screen && other !== layer)
            sources.push({ image: reference(other.element), box: other.screen });
        }
        // Glass inside opaque glass that encloses it sees only that glass.
        // Every -moz-element() source renders its whole element, so skipping
        // the content saves a full render of it whenever the content changes.
        const parent = lens.parents[0],
          enclosing = parent && layers.get(parent.serial)?.screen;
        const covered =
          parent &&
          enclosing &&
          parent.opacity >= 0.999 &&
          enclosing.left <= screen.left &&
          enclosing.top <= screen.top &&
          enclosing.left + enclosing.width >= screen.left + screen.width &&
          enclosing.top + enclosing.height >= screen.top + screen.height;
        if (!covered) sources.push({ image: reference(content), box: contentRect });
        // The progressive blur the content shows on screen, in this layer's space.
        const regions =
          covered || !blur
            ? []
            : blur.regions.flatMap((r) => {
                const [x, y] = toLayer(
                  contentRect.left + blur.left + r.x,
                  contentRect.top + blur.top + r.y,
                );
                const mapped = {
                  ...r,
                  x,
                  y,
                  width: r.width / f.sx,
                  height: r.height / f.sy,
                  blur: r.blur / Math.max(f.sx, f.sy),
                  refraction: r.refraction / Math.max(f.sx, f.sy),
                };
                const reach = 3 * mapped.blur + mapped.refraction;
                return mapped.x < local.width + reach &&
                  mapped.x + mapped.width > -reach &&
                  mapped.y < local.height + reach &&
                  mapped.y + mapped.height > -reach
                  ? [mapped]
                  : [];
              });
        if (regions.length)
          markup.push(
            progressiveGraph(`${layer.base}-blur`, regions, local.width, local.height, "gecko"),
          );
        // Gecko keeps a filter of blurs, blends and color passes on the GPU,
        // and renders one with an image or a displacement in software, where
        // the frost costs most of the glass and every composite runs a pixel
        // at a time. Frosted glass therefore only displaces in software, over
        // a plain copy of its backdrop, and the GPU masks that to the shape,
        // frosts it, and adds rim and light.
        const size = glassSize(lens.options, lens.w, lens.h);
        const recipe = glassRecipe(o, size);
        const split = recipe.blur > 0 || recipe.fill > 0;
        const part = split ? ("source" as const) : undefined;
        if (split) splitOf(layer);
        if (layer.split) {
          write(layer, "display", split ? "block" : "none", "glass");
          write(layer, "display", split ? "block" : "none", "light");
          write(layer, "display", split ? "block" : "none", "rim");
        }
        write(layer, "left", `${local.left}px`);
        write(layer, "top", `${local.top}px`);
        write(layer, "width", `${local.width}px`);
        write(layer, "height", `${local.height}px`);
        write(layer, "opacity", String(Math.round(lens.opacity * 1000) / 1000));
        if (layer.split)
          write(layer, "background-image", split ? "none" : sources.map((s) => s.image).join(", "));
        write(layer, "background-image", sources.map((s) => s.image).join(", "), part);
        // The backdrop color paints beneath every copy, inside the layer's
        // box; the glass's mask keeps it to the shape. A split layer is not
        // filtered itself, so only its masked parts carry it.
        const behind = backdrop ? backdropColor : "";
        const paintBackdrop = (value: string, on?: Part) => {
          if (value || layer.written.has(on ? `${on} background-color` : "background-color"))
            write(layer, "background-color", value, on);
        };
        paintBackdrop(split ? "" : behind);
        if (layer.split) paintBackdrop(split ? behind : "", "source");
        write(
          layer,
          "background-position",
          sources
            .map((s) => {
              const [x, y] = toLayer(s.box.left, s.box.top);
              return `${x}px ${y}px`;
            })
            .join(", "),
          part,
        );
        write(
          layer,
          "background-size",
          sources.map((s) => `${s.box.width / f.sx}px ${s.box.height / f.sy}px`).join(", "),
          part,
        );
        const region = `x="${lens_.left}" y="${lens_.top}" width="${lens_.width}" height="${lens_.height}"`;
        const image = (plane: MapPlane, result: string) =>
          mapImage(lens.maps, plane, result, lens_.left, lens_.top, lens_.width, lens_.height);
        const scale = Math.max(f.sx, f.sy);
        const open = (id: string) =>
          `<filter id="${id}" x="0" y="0" width="1" height="1" filterUnits="objectBoundingBox" primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB">`;
        if (split) {
          const tint = tintChannels(o);
          const frost = frostMarkup(p, "SourceGraphic", o, size, 1 / scale);
          const filled = fillMarkup(p, frost.result, "SourceGraphic", o, size, 1 / scale);
          // The refracted copy spans the shape and what its displacement
          // reads; the whole layer when a blur is placed in it.
          const reach = Math.ceil(lens.refraction / scale) + 2;
          const whole = regions.length > 0;
          const inner = whole
            ? { left: 0, top: 0, width: local.width, height: local.height }
            : {
                left: Math.max(0, lens_.left - reach),
                top: Math.max(0, lens_.top - reach),
                width:
                  Math.min(local.width, lens_.left + lens_.width + reach) -
                  Math.max(0, lens_.left - reach),
                height:
                  Math.min(local.height, lens_.top + lens_.height + reach) -
                  Math.max(0, lens_.top - reach),
              };
          const shape = {
            left: lens_.left - inner.left,
            top: lens_.top - inner.top,
            width: lens_.width,
            height: lens_.height,
          };
          const box = `x="${shape.left}" y="${shape.top}" width="${shape.width}" height="${shape.height}"`;
          const displaced = `<feDisplacementMap in="SourceGraphic" in2="${p}field" scale="${(2 * lens.refraction) / scale}" xChannelSelector="R" yChannelSelector="G" ${box}`;
          markup.push(
            `${open(layer.base)}${mapImage(lens.maps, "field", `${p}field`, shape.left, shape.top, shape.width, shape.height)}${displaced}/></filter>`,
            `${open(`${layer.base}-material`)}${frost.markup}${filled.markup}${toneMarkup(p, o, size, filled.result)}${tint ? tintMarkup(p, o, tint).markup : ""}</filter>`,
            ...(tint
              ? [
                  `${open(`${layer.base}-light`)}${overlayTintMarkup("SourceGraphic", `${p}light`, tint)}</filter>`,
                ]
              : []),
          );
          for (const [name, value] of Object.entries({
            left: inner.left,
            top: inner.top,
            width: inner.width,
            height: inner.height,
          }))
            write(layer, name, `${value}px`, "refracted");
          write(layer, "background-image", sources.map((s) => s.image).join(", "), "refracted");
          paintBackdrop(behind, "refracted");
          write(
            layer,
            "background-position",
            sources
              .map((s) => {
                const [x, y] = toLayer(s.box.left, s.box.top);
                return `${x - inner.left}px ${y - inner.top}px`;
              })
              .join(", "),
            "refracted",
          );
          write(
            layer,
            "background-size",
            sources.map((s) => `${s.box.width / f.sx}px ${s.box.height / f.sy}px`).join(", "),
            "refracted",
          );
          paintImages(layer, "refracted", "mask", planeImages(lens.maps, "field", shape), shape);
          paintImages(layer, "glass", "mask", planeImages(lens.maps, "field", lens_), lens_);
          paintImages(layer, "light", "background", planeImages(lens.maps, "light", lens_), lens_);
          paintImages(layer, "rim", "background", planeImages(lens.maps, "rim", lens_), lens_);
          continue;
        }
        let base = "SourceGraphic";
        const parts = [image("field", `${p}field`)];
        const frost = frostMarkup(p, base, o, size, 1 / scale);
        parts.push(frost.markup);
        base = frost.result;
        parts.push(
          refractMarkup(p, base, lens.refraction / scale, aberrationFor(o, size) / scale).replace(
            /<feDisplacementMap\b/g,
            `<feDisplacementMap ${region}`,
          ),
        );
        const filled = fillMarkup(p, `${p}refracted`, "SourceGraphic", o, size, 1 / scale);
        parts.push(filled.markup, toneMarkup(p, o, size, filled.result));
        let color = `${p}color`,
          light = `${p}light`;
        const tint = tintChannels(o);
        if (tint) {
          const tinted = tintMarkup(p, o, tint);
          parts.push(tinted.markup);
          color = tinted.color;
          light = `${p}tintLight`;
        }
        parts.push(
          image("light", `${p}light`),
          ...(tint ? [overlayTintMarkup(`${p}light`, light, tint)] : []),
          lightMarkup(p, color, light, `${p}field`, o.material).replace(
            /<feComposite\b/g,
            `<feComposite ${region}`,
          ),
          image("rim", `${p}rim`),
          outlineMarkup(p, "SourceGraphic", `${p}rim`, 1, outlineFor(o, size)),
          `<feComposite in="${p}rim" in2="${p}field" operator="in" ${region} result="${p}ring"/>`,
          `<feMerge ${region} result="${p}glass"><feMergeNode in="${p}outline"/><feMergeNode in="${p}litInside"/><feMergeNode in="${p}ring"/></feMerge>`,
        );
        // Pointwise passes only need the glass; the tone tables otherwise
        // run over the whole sampled neighborhood.
        const graph = parts
          .join("")
          .replace(
            /<(feComponentTransfer|feColorMatrix)\b(?![^>]*\sx=")([^>]*?)(\/?)>/g,
            `<$1$2 ${region}$3>`,
          );
        markup.push(`${open(layer.base)}${graph}</filter>`);
      }
      const live = patchFilters(defs, markup, mapUrl);
      const blurred = new Set(markup.map((m) => /id="([^"]+)"/.exec(m)![1]));
      for (const { lens, layer } of plans) {
        if (lens.mode !== "copy") {
          applyOwn(layer, live, blurred);
          continue;
        }
        const id = `${layer.base}-blur`;
        const own = [blurred.has(id) ? `url("#${live(id)}")` : "", `url("#${live(layer.base)}")`]
          .filter(Boolean)
          .join(" ");
        const split = layer.split && layer.written.get("glass display") === "block";
        if (layer.split) write(layer, "filter", split ? "none" : own);
        if (!split) {
          write(layer, "filter", own);
          continue;
        }
        write(layer, "filter", own, "refracted");
        write(layer, "filter", blurred.has(id) ? `url("#${live(id)}")` : "none", "source");
        write(layer, "filter", `url("#${live(`${layer.base}-material`)}")`, "glass");
        write(
          layer,
          "filter",
          blurred.has(`${layer.base}-light`) ? `url("#${live(`${layer.base}-light`)}")` : "none",
          "light",
        );
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
