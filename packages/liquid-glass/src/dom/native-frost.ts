import { materials } from "../core/materials.js";
import type { MaterialOptions } from "../core/materials.js";
import type { MapPlane } from "./map-image.js";
import type { MaterialMaps } from "./maps.js";
import { touchMaps } from "./maps.js";

/** WebKit runs every SVG filter in software, over the whole content on each
 * change, and the frost's two blurs with their tone are a third of that. Its
 * compositor blurs a backdrop on the GPU. A plain Regular surface therefore
 * only refracts in the content's filter; a layer just above the content
 * frosts and tones what shows through with backdrop filters masked to the
 * shape, and paints the rim and light above. A surface clips itself to its
 * shape, which hides the backdrop from anything inside it, so the layers
 * live beside the content and follow their surfaces.
 *
 * Backdrop filters offer no curves, so the tone is its closest straight
 * line, within 3 levels of 255 in light appearance and 6 in dark, and the frost blurs the refracted backdrop
 * where the filter refracts the frosted one: the rim's light band is softer. */
export interface FrostedSurface {
  serial: number;
  element: HTMLElement;
  options: MaterialOptions;
  maps: MaterialMaps;
  /** Drawn glass in content coordinates, in CSS pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Frost {
  layer: HTMLDivElement;
  parts: HTMLDivElement[];
  written: string;
  placed: string;
}

export const supportsNativeFrost = (): boolean =>
  typeof CSS !== "undefined" &&
  (CSS.supports("backdrop-filter", "blur(1px)") ||
    CSS.supports("-webkit-backdrop-filter", "blur(1px)"));

/** `contrast()` then `brightness()` that draw the line nearest the tone curve. */
export function toneFilters(o: MaterialOptions): string {
  const dark = o.appearance === "dark";
  const [a, b, q, chroma] = (dark ? materials.regular.dark : materials.regular.light).tone;
  const weight = dark ? 0.9 : 0.8;
  // Over 0 to 1, the line that strays least from v² is v − 1/8.
  const offset = weight * (a - q / 8),
    slope = weight * (b + q) + (1 - weight);
  const brightness = slope + 2 * offset;
  return `contrast(${(slope / brightness).toFixed(4)}) brightness(${brightness.toFixed(4)}) saturate(${chroma})`;
}

/** The images of one map plane across a box: one, or the two caps and the stretched middle of a capsule. */
function planeImages(maps: MaterialMaps, plane: MapPlane, width: number, height: number) {
  touchMaps(maps);
  const slices = maps.capsule;
  const cap = slices ? (slices.cap * height) / slices.height : 0;
  if (!slices || width < cap * 2) return [{ url: maps[plane], left: 0, width }];
  const [left, middle, right] = slices.planes[plane];
  return [
    { url: right, left: width - cap, width: cap },
    { url: left, left: 0, width: cap },
    { url: middle, left: cap - 0.5, width: width - cap * 2 + 1 },
  ];
}

export function createNativeFrost() {
  const frosts = new Map<number, Frost>();
  const nodes = new WeakSet<Node>();
  let holder: HTMLDivElement | undefined;
  return {
    update(surfaces: readonly FrostedSurface[], content: HTMLElement) {
      const keep = new Set(surfaces.map((surface) => surface.serial));
      for (const [serial, frost] of frosts)
        if (!keep.has(serial)) {
          frost.layer.remove();
          frosts.delete(serial);
        }
      if (!surfaces.length) {
        holder?.remove();
        return;
      }
      if (!holder) {
        holder = content.ownerDocument.createElement("div");
        holder.setAttribute("aria-hidden", "true");
        holder.dataset.glassFrost = "";
        Object.assign(holder.style, {
          position: "absolute",
          left: "0",
          top: "0",
          width: "0",
          height: "0",
          pointerEvents: "none",
        });
        nodes.add(holder);
      }
      // Above the content and beneath every surface that follows it.
      if (holder.previousSibling !== content) content.after(holder);
      const origin = holder.getBoundingClientRect(),
        box = content.getBoundingClientRect();
      const left = box.left - origin.left,
        top = box.top - origin.top;
      for (const surface of surfaces) {
        let frost = frosts.get(surface.serial);
        if (!frost) {
          const document = content.ownerDocument;
          const layer = document.createElement("div");
          Object.assign(layer.style, {
            position: "absolute",
            left: "0",
            top: "0",
            pointerEvents: "none",
          });
          const parts = [0, 1, 2, 3].map(() => {
            const part = document.createElement("div");
            Object.assign(part.style, {
              position: "absolute",
              inset: "0",
              pointerEvents: "none",
              backgroundRepeat: "no-repeat",
              webkitMaskRepeat: "no-repeat",
              maskRepeat: "no-repeat",
            });
            nodes.add(part);
            return part;
          });
          layer.append(...parts);
          nodes.add(layer);
          frost = { layer, parts, written: "", placed: "" };
          frosts.set(surface.serial, frost);
        }
        if (frost.layer.parentNode !== holder) holder.append(frost.layer);
        // The maps reach two pixels past the surface for their soft edge.
        const placed = `translate(${Math.round((left + surface.x - 2) * 100) / 100}px, ${Math.round((top + surface.y - 2) * 100) / 100}px)`;
        if (frost.placed !== placed) {
          frost.placed = placed;
          frost.layer.style.transform = placed;
        }
        const o = surface.options,
          dark = o.appearance === "dark";
        const spec = dark ? materials.regular.dark : materials.regular.light;
        const width = surface.w + 4,
          height = surface.h + 4;
        const field = planeImages(surface.maps, "field", width, height),
          overlay = planeImages(surface.maps, "overlay", width, height);
        const key = `${field.map((i) => i.url.length + i.url.slice(-24)).join()}|${overlay.map((i) => i.url.length + i.url.slice(-24)).join()}|${width}|${height}|${dark}`;
        if (frost.written === key) continue;
        frost.written = key;
        frost.layer.style.width = `${width}px`;
        frost.layer.style.height = `${height}px`;
        const place = (images: typeof field) => ({
          image: images.map((i) => `url("${i.url}")`).join(", "),
          position: images.map((i) => `${i.left}px 0px`).join(", "),
          size: images.map((i) => `${i.width}px 100%`).join(", "),
        });
        const mask = place(field),
          light = place(overlay);
        const [blur, fill, tone, rim] = frost.parts as [
          HTMLDivElement,
          HTMLDivElement,
          HTMLDivElement,
          HTMLDivElement,
        ];
        const filters = [
          `blur(${materials.regular.blur}px)`,
          `blur(${spec.fillSigma}px)`,
          toneFilters(o),
        ];
        [blur, fill, tone].forEach((part, index) => {
          part.style.setProperty("-webkit-backdrop-filter", filters[index]!);
          part.style.setProperty("backdrop-filter", filters[index]!);
          for (const prefix of ["-webkit-mask", "mask"]) {
            part.style.setProperty(`${prefix}-image`, mask.image);
            part.style.setProperty(`${prefix}-position`, mask.position);
            part.style.setProperty(`${prefix}-size`, mask.size);
          }
        });
        // The wider blur lightens the frost (darkens it in dark appearance) at the fill's weight.
        fill.style.mixBlendMode = dark ? "darken" : "lighten";
        fill.style.opacity = String(spec.fillOpacity);
        rim.style.backgroundImage = light.image;
        rim.style.backgroundPosition = light.position;
        rim.style.backgroundSize = light.size;
      }
    },
    owns: (node: Node): boolean => nodes.has(node),
    dispose() {
      holder?.remove();
      frosts.clear();
    },
  };
}
export type NativeFrost = ReturnType<typeof createNativeFrost>;
