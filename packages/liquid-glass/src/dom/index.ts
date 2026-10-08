import { polygonClip } from "../core/concentric.js";
import type { ShapePoint } from "../core/concentric.js";
import { createConcentricResolver, setResolvedShape, registerShapeContainer } from "./shape-layout.js";
import { getLayoutSize } from "@lisse/core";
import { shapeClip, shapePolygon, cornerOptions } from "../core/shape.js";
import { attachInteraction, resolveMotion } from "./interaction.js";
import type { GlassMotion, SurfaceAnimator } from "./interaction.js";
import { attachGeometryMotion } from "./morph.js";
import type { GeometryAnimator, GlassMorph, LensPlacement, LensWaypoint } from "./morph.js";
export { attachInteraction, resolveMotion } from "./interaction.js";
export type { GlassMotion, SurfaceAnimator } from "./interaction.js";
export { attachGeometryMotion, radiusPixels } from "./morph.js";
export { attachSelectionLens } from "./selection.js";
export type { GeometryAnimator, GeometryMotionOptions, GlassMorph, LensFrame, LensPlacement, LensWaypoint } from "./morph.js";
import { shapeDistance } from "../core/morph-path.js";
import { comparePaintOrder, foregroundFilter, overlaps } from "./foreground.js";
import type { ForegroundLens } from "./foreground.js";
import { patchFilters } from "./filter-patch.js";
import { createMapWarmer } from "./warm.js";
import { updateControlMotion } from "./control-motion.js";
import { createProgressiveLayer } from "./progressive.js";
import type { ScrollEdgesOptions } from "./progressive.js";
import type { ProgressiveBlurOptions } from "../core/progressive.js";
export type { ScrollEdgesOptions, GlassScrollTarget } from "./progressive.js";
import { crossedSides, edgeTiles, filterBounds, tilesFor } from "./filter-bounds.js";
import { blurOutsets, filterBudgetFactor, webkit } from "./filter-budget.js";
import type { FilterBounds } from "./filter-bounds.js";
import { materials } from "../core/materials.js";
import type { MaterialOptions } from "../core/materials.js";
import { getMaterialMaps, getSurfaceMaterialMaps, peekMaterialMaps, peekSurfaceMaterialMaps } from "./maps.js";
import { getMaterialRenderer } from "../gpu/index.js";
import { capsuleMapGeometry, mapImage, mapUrl } from "./map-image.js";
import type { MapPlane } from "./map-image.js";
import type { MaterialMaps } from "./maps.js";
import type { MapGeometry } from "../gpu/index.js";
import { createTicker } from "./ticker.js";
export { getMaterialMaps, clearMaterialMapCache } from "./maps.js";
export type { MaterialMaps } from "./maps.js";
export interface GlassDiagnostic {
  surfaces: number;
  maps: number;
  mapTime: number;
  error?: Error;
}
export interface GlassSceneOptions {
  onDiagnostic?: (diagnostic: GlassDiagnostic) => void;
  maxSurfaces?: number;
}
/** Material plus the motion a registered surface takes part in. */
export interface SurfaceOptions extends MaterialOptions {
  /** React to touch and pointer input: grow, stretch toward a drag, settle with
   * overshoot, and light up beneath the pointer. */
  interactive?: boolean;
  /** Grow out of this element when registered, and back into it when Base UI
   * marks the popup with `data-ending-style`. */
  morphFrom?: () => Element | null | undefined;
  /** `become`: the source's glass is this surface, and withdraws its own
   * content while the surface is present. `detach`: this surface leaves the
   * source's glass as a drop, joined by a liquid neck until they part.
   * Default: a glass source is become; a source inside glass, such as a
   * toolbar button, is detached from. */
  morph?: GlassMorph;
  /** Spring the glass outline when the surface's layout box changes. */
  fluid?: boolean;
  /** Motion level for this surface. System reduced motion always applies. */
  motion?: GlassMotion;
  /** Neck reach of a detaching drop in pixels; `0` grows a plain shape. */
  neck?: number;
  /** Grow out of `morphFrom` when registered. `false` only runs the exit. */
  morphEnter?: boolean;
}
export interface GlassSceneController {
  setContent(element: HTMLElement | null): void;
  addSurface(element: HTMLElement, options?: SurfaceOptions): () => void;
  /** Live DOM above the backdrop that must pass through overlapping glass. */
  addForeground(element: HTMLElement): () => void;
  /** Step an animation each frame before the scene samples glass geometry. */
  addAnimator(animator: SurfaceAnimator): () => void;
  addProgressiveBlur(element: HTMLElement, options?: ProgressiveBlurOptions): () => void;
  addScrollEdges(options: ScrollEdgesOptions): () => void;
  dispose(): void;
}
interface Lens {
  /** Stable identity for this surface's retained filter. */
  serial: number;
  element: HTMLElement;
  options: SurfaceOptions;
  maps?: MaterialMaps;
  error?: Error;
  key?: string;
  /** The geometry measured most recently, which an in-flight request may predate. */
  wanted?: string;
  /** One map request in flight per lens; the newest result is shown meanwhile. */
  inflight?: boolean;
  animators: SurfaceAnimator[];
  outline?: GeometryAnimator;
  /** The animation path whose maps are prepared, and the shape currently shown. */
  path?: readonly LensWaypoint[];
  prepared: Map<string, PreparedMaps>;
  /** Glass this lens currently draws in its place, and how much of it. */
  absorbs?: { element: Element; weight: number };
  /** The prepared shapes drawn this frame, each in its box, blended by `mix`. */
  place?: { a: Placed; b: Placed; mix: number; stretched: boolean };
  /** When the layout size last changed. */
  resized?: number;
  preparing: Set<string>;
  shown?: MapGeometry;
  geometryKey?: string;
  clip: string;
  borderRadius: string;
  releaseShape: () => void;
  resolveShape?: () => ShapePoint[] | undefined;
  x: number;
  y: number;
  w: number;
  h: number;
  opacity: number;
  /** Inline styles as last written, so they are never read back to compare. */
  writtenClip?: string;
  writtenRadius?: string;
  writtenReady?: string;
}
let serial = 0;
let lensSerial = 0;
/** Shapes in motion use 1× maps: a quarter of the pixels to render, encode
 * and decode each frame. The resting shape returns to full density. */
const motionDpr = 1;
const mapKey = (g: MapGeometry) => JSON.stringify(capsuleMapGeometry(g) ?? g);
/** Maps for a shape an animation will pass through, usable once warm. */
interface PreparedMaps { geometry: MapGeometry; maps: MaterialMaps; ready: number }
/** Prepared maps placed in content coordinates. */
interface Placed { maps: MaterialMaps; x: number; y: number; w: number; h: number }
/** Time a new map image is given to load and decode before it is shown. */
const warmup = 50;
/** Opacity the material inherits from its element and ancestors in the scene. */
function effectiveOpacity(element: HTMLElement, root: HTMLElement): number {
  let opacity = 1;
  for (let node: HTMLElement | null = element; node && node !== root; node = node.parentElement) {
    const value = Number(getComputedStyle(node).opacity);
    if (Number.isFinite(value)) opacity *= value;
    if (opacity < 0.001) return 0;
  }
  return opacity;
}
const ns = "http://www.w3.org/2000/svg";
/** Refract one explicit live DOM layer. Foreground controls stay semantic HTML. */
export function createGlassScene(
  root: HTMLElement,
  config: GlassSceneOptions = {},
): GlassSceneController {
  const owner = ++serial;
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.style.position = "absolute";
  svg.style.inset = "0";
  svg.style.pointerEvents = "none";
  const defs = document.createElementNS(ns, "defs");
  svg.append(defs);
  root.append(svg);
  const maxSurfaces = Math.max(
    1,
    Math.min(64, Math.floor(config.maxSurfaces ?? 16)),
  );
  let notified = "";
  let content: HTMLElement | null = null,
    disposed = false,
    dirty = true,
    lastSize = "";
  const lenses = new Set<Lens>();
  const animators = new Set<SurfaceAnimator>();
  /** Map requests whose arrival will change the scene. */
  let pending = 0;
  /** Popup surfaces currently registered. */
  let popups = 0;
  /** A surface waited for the maps of its path last frame. Everything else
   * holds still meanwhile: filters redrawn every frame, and the GPU work
   * behind them, would keep those maps from arriving until the motion was
   * over. The wait is short, and the surface about to move covers it. */
  let quiet = false;
  /** When the filter was last rebuilt for motion. Every rebuild re-rasters the
   * whole filtered layer, which takes most of a 120 Hz frame; rebuilding at
   * 60 Hz lands every frame on time instead of alternating one and two. */
  let composedAt = 0;
  const notify = (error?: Error) => {
    error ??= [...lenses].find((l) => l.error)?.error;
    const ready = [...lenses].filter((l) => l.maps);
    const readyValue = String(ready.length === lenses.size && !error);
    if (root.dataset.glassReady !== readyValue) root.dataset.glassReady = readyValue;
    const key = `${lenses.size},${ready.length},${error?.message ?? ""},${ready.reduce((n, l) => n + l.maps!.duration, 0)}`;
    if (notified === key) return;
    notified = key;
    config.onDiagnostic?.({
      surfaces: lenses.size,
      maps: ready.length,
      mapTime: ready.reduce((n, l) => n + l.maps!.duration, 0),
      error,
    });
    root.dispatchEvent(
      new CustomEvent("glass:diagnostic", {
        detail: {
          surfaces: lenses.size,
          maps: ready.length,
          error: error?.message,
        },
      }),
    );
  };
  const progressive = createProgressiveLayer(root, (error) => notify(error));
  const warmer = createMapWarmer(root);
  // Resting glass draws from stored maps without a GPU device. The device is
  // brought up shortly after, while the page is quiet: a device's first work
  // waits for painting to stop, which would hold a menu's first opening back
  // for as long as its own motion lasts.
  const warmRenderer = typeof navigator !== "undefined" && "gpu" in navigator
    ? setTimeout(() => { getMaterialRenderer().then((renderer) => renderer.warmed).catch(() => undefined); }, 600)
    : undefined;
  let surfaceFilters = "";
  let lastPaintOrder = "";
  const foregroundStyles = new Map<HTMLElement, string>();
  const foregrounds = new Set<ForegroundLens & { serial: number }>();
  const releaseContent = (element: HTMLElement) => {
    element.style.filter = "";
    if (element.style.willChange === "transform") element.style.willChange = "";
  };
  const restoreForeground = (element: HTMLElement) => {
    const original = foregroundStyles.get(element);
    if (original !== undefined) {
      element.style.filter = original;
      foregroundStyles.delete(element);
    }
  };
  /** Displacement travel of a lens, in CSS pixels. Nested glass already sees
   * its parent's refracted rim and keeps its travel within the inset. */
  const refractionOf = (l: Lens, parents: Lens[]) => {
    if (l.options.refraction !== undefined) return l.options.refraction;
    if (!parents.length) return materials[l.options.material ?? "clear"].refraction;
    const inset = Math.min(...parents.map((parent) => Math.min(
      l.x - parent.x, l.y - parent.y,
      parent.x + parent.w - l.x - l.w,
      parent.y + parent.h - l.y - l.h,
    )));
    return Math.max(0, Math.min(8, inset * 0.6));
  };
  const parentsOf = (l: Lens) => [...lenses].filter((parent) => parent !== l && parent.element.contains(l.element));
  /** Backdrop a lens samples beyond its box: its blur support plus its displacement. */
  const paddingOf = (l: Lens, amount: number, soften: number) => {
    const regular = l.options.material === "regular";
    const blur = regular ? Math.max(materials.regular.blur, (l.options.appearance === "dark" ? materials.regular.dark : materials.regular.light).fillSigma) * soften : 0;
    return Math.ceil(3 * blur + amount + 8);
  };
  /** Paint order changes only with the DOM: it is sorted again after a
   * mutation or a registration, never on every frame. */
  let structure = 0, orderedAt = -1, ordered: Lens[] = [];
  const order = () => {
    if (orderedAt !== structure) {
      ordered = [...lenses].sort((a, b) => comparePaintOrder(a.element, b.element));
      orderedAt = structure;
    }
    return ordered;
  };
  let foregroundOrderAt = -1;
  let foregroundOrder: (ForegroundLens & { serial: number })[] = [];
  const orderForeground = () => {
    if (foregroundOrderAt !== structure) {
      foregroundOrder = [...order(), ...foregrounds].sort((a, b) => comparePaintOrder(a.element, b.element));
      foregroundOrderAt = structure;
    }
    return foregroundOrder;
  };
  /** Rebuild the filters for the measured content size. The filter's
   * bounding box is the content layer, which can be taller than the scene
   * when it uses flow layout inside a scroller. */
  function compose(width: number, height: number) {
    if (!content) return;
    if (!width || !height) {
      content.style.filter = "";
      return;
    }
    // Resizing the host svg invalidates every filter it defines.
    if (svg.getAttribute("width") !== String(width) || svg.getAttribute("height") !== String(height)) {
      svg.setAttribute("width", String(width));
      svg.setAttribute("height", String(height));
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    }
    // Stable per-surface ids keep the content layer's filter reference
    // unchanged while surfaces animate; only attributes are patched.
    const id = `lg-${owner}`;
    const filters: string[] = [],
      applied: string[] = [];
    const ordered = order();
    // One filter draws every surface of the scene. The source is extended
    // once; each surface works only inside its own crop and contributes its
    // masked material, rim, and light to a single final merge. A surface's
    // sampled backdrop includes earlier surfaces only when it is near enough
    // to see them, so full-size intermediates are built only where needed.
    const drawn = ordered.filter((l) => l.maps && l.opacity >= 0.001);
    const parents = new Map(drawn.map((l) => [l, parentsOf(l)] as const));
    const wanted = new Map(drawn.map((l) => [l, refractionOf(l, parents.get(l)!)] as const));
    // WebKit charges the outsets of every lens against one buffer budget.
    const scale = typeof devicePixelRatio === "number" && devicePixelRatio > 0 ? devicePixelRatio : 1;
    const outsets = drawn.reduce((sum, l) => {
      const spec = l.options.appearance === "dark" ? materials.regular.dark : materials.regular.light;
      const blur = l.options.material === "regular" ? blurOutsets(materials.regular.blur) + blurOutsets(spec.fillSigma) : 0;
      return sum + scale * (blur + wanted.get(l)!);
    }, 0);
    const soften = filterBudgetFactor(width * scale, height * scale, outsets);
    const amounts = new Map(drawn.map((l) => [l, wanted.get(l)! * soften] as const));
    const paddings = new Map(drawn.map((l) => [l, paddingOf(l, amounts.get(l)!, soften)] as const));
    // Glass shows other glass when it overlaps it or bends it in from its
    // rim; a frosted blur reaching further adds only a faint tint, not worth
    // a shared full-size pass on every frame.
    const reach = (l: Lens) => 0.5 * (l.options.refraction ?? materials[l.options.material ?? "clear"].refraction) + 4;
    // Every surface samples its own padded crop; shared intermediates only
    // need to cover the crops of the surfaces that read them.
    const cropOf = (l: Lens) => {
      const padding = paddings.get(l)!;
      return { x: l.x - 2 - padding, y: l.y - 2 - padding, width: l.w + 4 + 2 * padding, height: l.h + 4 + 2 * padding };
    };
    const crops = drawn.map(cropOf);
    const bounds = filterBounds(width, height, crops, 0);
    const region = (box: FilterBounds) => `x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}"`;
    // Edge pixels are repeated only past the sides some surface samples
    // beyond; glass well inside its content reads the source directly.
    // WebKit draws a filter that repeats edge pixels with feTile scaled away
    // from its element, worse with every surface that reads a tile. There the
    // material fades at the content's edge and the sharp source shows through
    // instead, which only glass at the very edge of its scene can notice.
    const tiles = drawn.length && !webkit ? edgeTiles(width, height, bounds, "scene", crossedSides(width, height, crops)) : { markup: "", names: {} };
    const parts: string[] = [tiles.markup];
    const source = "SourceGraphic";
    // Every input a surface reads is a realized image: the source, edge
    // tiles, map images, and the finished layers of glass it overlaps. A
    // finished layer read by a second consumer with different bounds is
    // evaluated again from its blurs up, so glass merely near another
    // surface takes only that surface's rim and light images instead.
    const layersOf = new Map<Lens, string[]>();
    /** Where each surface's primitives start; WebKit gets one filter per
     * surface, chained, since the outsets of every blur and displacement in
     * one filter add up there and scale its whole output. */
    const starts: number[] = [];
    drawn
      .forEach((l, i) => {
        starts.push(parts.length);
        const o = l.options,
          m = l.maps!,
          // Names follow the surface, not its position, so primitives persist
          // as other surfaces enter and leave the scene.
          p = `s${l.serial}`,
          dark = o.appearance === "dark";
        const x = l.x - 2,
          y = l.y - 2,
          w = l.w + 4,
          h = l.h + 4;
        /** A resting surface draws its map in its box. In motion it draws the
         * two prepared shapes around the frame, each in its own box, blended;
         * the structure stays the same for every frame of the motion, so the
         * retained filter only changes attributes. */
        const image = (plane: MapPlane, result: string) => {
          const place = l.place;
          if (!place) return mapImage(m, plane, result, x, y, w, h);
          const at = (q: Placed, name: string) => mapImage(q.maps, plane, name, q.x - 2, q.y - 2, q.w + 4, q.h + 4);
          return at(place.a, `${result}A`) + at(place.b, `${result}B`)
            + `<feComposite in="${result}A" in2="${result}B" operator="arithmetic" k1="0" k2="${(1 - place.mix).toFixed(4)}" k3="${place.mix.toFixed(4)}" k4="0" result="${result}"/>`;
        };
        const opaque = l.opacity >= 0.999;
        const first = parts.length;
        parts.push(
          // Displacement outside the shape is masked away, so the map needs no neutral fill.
          image("displacement", `${p}map`),
          image("mask", opaque ? `${p}mask` : `${p}rawmask`),
          ...(opaque ? [] : [`<feComponentTransfer in="${p}rawmask" result="${p}mask"><feFuncA type="linear" slope="${l.opacity}"/></feComponentTransfer>`]),
        );
        const nested = parents.get(l)!;
        // Keep blur intermediates local to the lens, including its sampling
        // margin. Full-scene intermediates exceed WebKit's filter budget.
        const crop = crops[i]!;
        const r = reach(l);
        // In a chain the source already holds the glass drawn before.
        const beneath = webkit ? [] : drawn.slice(0, i).filter((earlier) =>
          earlier.x < l.x + l.w + r && l.x - r < earlier.x + earlier.w && earlier.y < l.y + l.h + r && l.y - r < earlier.y + earlier.h);
        const inputs: string[] = [];
        for (const earlier of beneath) {
          const touching = earlier.x < l.x + l.w && l.x < earlier.x + earlier.w && earlier.y < l.y + l.h && l.y < earlier.y + earlier.h;
          if (touching) inputs.push(...layersOf.get(earlier)!);
          else {
            const q = `s${earlier.serial}`;
            parts.push(mapImage(earlier.maps!, "outline", `${p}by${q}rim`, earlier.x - 2, earlier.y - 2, earlier.w + 4, earlier.h + 4),
              mapImage(earlier.maps!, "highlight", `${p}by${q}light`, earlier.x - 2, earlier.y - 2, earlier.w + 4, earlier.h + 4));
            inputs.push(`${p}by${q}rim`, `${p}by${q}light`);
          }
        }
        const edges = tilesFor(width, height, crop).map((key) => tiles.names[key]).filter((name): name is string => Boolean(name));
        // Always a merge, so the primitive keeps its identity as edge tiles
        // and neighbors come and go; a one-input merge is a plain copy.
        parts.push(`<feMerge result="${p}crop" ${region(crop)}>${edges.map((n) => `<feMergeNode in="${n}"/>`).join("")}<feMergeNode in="${source}"/>${inputs.map((n) => `<feMergeNode in="${n}"/>`).join("")}</feMerge>`);
        const cropped = `${p}crop`;
        let base = cropped;
        if (o.material === "regular") {
          const spec = dark ? materials.regular.dark : materials.regular.light;
          parts.push(
            `<feGaussianBlur in="${cropped}" stdDeviation="${materials.regular.blur * soften}" result="${p}frost"/><feGaussianBlur in="${cropped}" stdDeviation="${spec.fillSigma * soften}" result="${p}fill"/><feBlend in="${p}frost" in2="${p}fill" mode="${dark ? "darken" : "lighten"}" result="${p}blend"/><feComposite in="${p}blend" in2="${p}frost" operator="arithmetic" k2="${spec.fillOpacity}" k3="${1 - spec.fillOpacity}" result="${p}mix"/>`,
          );
          base = `${p}mix`;
          // SVG's per-channel transfer is a calibrated tone curve, then a chroma matrix.
          const [a, b, q, chroma] = spec.tone;
          const table = Array.from({ length: 33 }, (_, n) => {
            const v = n / 32;
            const toned = a + b * v + q * v * v;
            const toneWeight = dark ? 0.90 : 0.80;
            return toneWeight * toned + (1 - toneWeight) * v;
          }).join(" ");
          parts.push(
            `<feComponentTransfer in="${base}" result="${p}tone"><feFuncR type="table" tableValues="${table}"/><feFuncG type="table" tableValues="${table}"/><feFuncB type="table" tableValues="${table}"/></feComponentTransfer><feColorMatrix in="${p}tone" type="saturate" values="${chroma}" result="${p}color"/>`,
          );
        } else {
          const spec = dark ? materials.clear.dark : materials.clear.light;
          // A second dark layer needs a distinct light response, rather than
          // converging on the same tone as the containing surface.
          const table = Array.from({ length: 33 }, (_, n) => {
            const v = n / 32;
            const tone = v + spec.shadowLift * (1 - v) ** 3
              - spec.highlightRolloff * v ** 3;
            // Keep a subtle broad tint, with less veil in light appearance
            // and a slightly stronger pale response in dark appearance.
            const tinted = dark ? 0.38 * v + 0.20 : 0.78 * v + 0.26;
            const tintWeight = dark ? 0.14 : 0.06;
            const layerLight = dark && nested.length ? 0.08 * (1 - v) : 0;
            return Math.max(0, Math.min(1, (1 - tintWeight) * tone + tintWeight * tinted + layerLight));
          }).join(" ");
          parts.push(
            `<feComponentTransfer in="${cropped}" result="${p}color"><feFuncR type="table" tableValues="${table}"/><feFuncG type="table" tableValues="${table}"/><feFuncB type="table" tableValues="${table}"/></feComponentTransfer>`,
          );
        }
        const amount = amounts.get(l)!;
        parts.push(
          `<feDisplacementMap in="${p}color" in2="${p}map" scale="${amount * 2}" xChannelSelector="R" yChannelSelector="G" result="${p}refracted"/>`,
        );
        let color = `${p}refracted`;
        let highlight = `${p}light`;
        const tint = o.tint && /^#[\da-f]{6}$/i.test(o.tint)
          ? [1, 3, 5].map((offset) => parseInt(o.tint!.slice(offset, offset + 2), 16) / 255)
          : undefined;
        if (tint) {
          // Colored glass transmits luminance, rather than mixing neutral
          // backdrop RGB into a weak overlay. A pale backdrop can brighten
          // the pigment without removing its chroma; dark detail stays visible.
          const body = o.material === "regular" ? 0.78 : 0.68;
          const channels = ["R", "G", "B"];
          parts.push(
            `<feColorMatrix in="${color}" type="saturate" values="0" result="${p}luminance"/>`,
            `<feComponentTransfer in="${p}luminance" result="${p}tinted">${channels.map((channel, index) => `<feFunc${channel} type="linear" slope="${tint[index]! * (1 - body)}" intercept="${tint[index]! * body}"/>`).join("")}<feFuncA type="linear" slope="${1 - body}" intercept="${body}"/></feComponentTransfer>`,
          );
          color = `${p}tinted`;
          highlight = `${p}tintLight`;
        }
        parts.push(
          ...(webkit
            ? [`<feComposite in="${color}" in2="${p}mask" operator="in" result="${p}insideFaded"/>`,
              `<feComposite in="${source}" in2="${p}mask" operator="in" result="${p}under"/>`,
              `<feComposite in="${p}insideFaded" in2="${p}under" operator="over" result="${p}inside"/>`]
            : [`<feComposite in="${color}" in2="${p}mask" operator="in" result="${p}inside"/>`]),
          image("outline", `${p}outline`),
          image("highlight", `${p}light`),
          // Preserve the WGSL highlight coverage while coloring its radiance.
          ...(tint ? [`<feComponentTransfer in="${p}light" result="${highlight}">${["R", "G", "B"].map((channel, index) => `<feFunc${channel} type="linear" slope="0" intercept="${0.45 + 0.55 * tint[index]!}"/>`).join("")}</feComponentTransfer>`] : []),
          // Fully opaque glass needs no opacity pass over its rim and light.
          ...(opaque ? [] : [
            `<feComponentTransfer in="${p}outline" result="${p}fadedOutline"><feFuncA type="linear" slope="${l.opacity}"/></feComponentTransfer>`,
            `<feComponentTransfer in="${highlight}" result="${p}fadedLight"><feFuncA type="linear" slope="${l.opacity}"/></feComponentTransfer>`,
          ]),
        );
        // Without a subregion every primitive covers the whole filter region,
        // the scene plus padding. Only the surface's box matters, plus the
        // reach of its displacement for the material it samples.
        const reachBox = { x: x - amount - 3, y: y - amount - 3, width: w + 2 * amount + 6, height: h + 2 * amount + 6 };
        const sampledStages = new Set(["frost", "fill", "blend", "mix", "tone", "color"].map((name) => `${p}${name}`));
        for (let index = first; index < parts.length; index++)
          parts[index] = parts[index]!.replace(/<(feFlood|feComposite|feDisplacementMap|feColorMatrix|feComponentTransfer|feGaussianBlur|feBlend)\b([^>]*?)(\/?)>/g,
            (tag, name: string, attributes: string, close: string) => {
              if (/\sx="/.test(attributes)) return tag;
              const region = sampledStages.has(/result="([^"]+)"/.exec(attributes)?.[1] ?? "") ? reachBox : { x, y, width: w, height: h };
              return `<${name}${attributes} x="${region.x}" y="${region.y}" width="${region.width}" height="${region.height}"${close}>`;
            });
        const layer = [`${p}inside`, opaque ? `${p}outline` : `${p}fadedOutline`, opaque ? highlight : `${p}fadedLight`];
        layersOf.set(l, layer);
      });
    // Bounding-box coordinates anchor HTML filters consistently in WebKit.
    // SVG displacement scale is resolved against the horizontal axis; do
    // not rescale its Y channel by the scene aspect ratio.
    const toBoundingBox = (markup: string) => markup
        .replace(/\b(x|y|width|height)="([-\d.]+)"/g,
          (_match, name: string, value: string) => `${name}="${Number(value) / (name === "x" || name === "width" ? width : height)}"`)
        .replace(/stdDeviation="([\d.]+)"/g,
          (_match, value: string) => `stdDeviation="${Number(value) / width} ${Number(value) / height}"`)
        .replace(/scale="([\d.]+)"/g,
          (_match, value: string) => `scale="${Number(value) / width}"`);
    const filterMarkup = (filterId: string, primitives: string) =>
      `<filter id="${filterId}" x="${bounds.x / width}" y="${bounds.y / height}" width="${bounds.width / width}" height="${bounds.height / height}" filterUnits="objectBoundingBox" primitiveUnits="objectBoundingBox" color-interpolation-filters="sRGB">${primitives}</filter>`;
    // Replace covered input, rather than painting a sparse refracted copy
    // over its sharp original. Each pass also replaces lower glass.
    const composite = (lens: Lens, input: string) => {
      const p = `s${lens.serial}`;
      // The material is opaque inside its mask, so drawing it over the input
      // replaces what it covers. WebKit pays for every full-size pass, so it
      // merges once instead of cutting the covered input out first.
      if (webkit) return `<feMerge result="${p}composite"><feMergeNode in="${input}"/>${layersOf.get(lens)!.map((n) => `<feMergeNode in="${n}"/>`).join("")}</feMerge>`;
      return `<feComposite in="${input}" in2="${p}mask" operator="out" result="${p}outside"/><feMerge result="${p}composite"><feMergeNode in="${p}outside"/>${layersOf.get(lens)!.map((n) => `<feMergeNode in="${n}"/>`).join("")}</feMerge>`;
    };
    if (drawn.length && webkit) {
      drawn.forEach((lens, i) => {
        const own = parts.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : parts.length).join("") + composite(lens, "SourceGraphic");
        const filterId = `${id}-s${lens.serial}`;
        filters.push(filterMarkup(filterId, toBoundingBox(own)));
        applied.push(filterId);
      });
    } else if (drawn.length) {
      let input = "SourceGraphic";
      for (const lens of drawn) { parts.push(composite(lens, input)); input = `s${lens.serial}composite`; }
      const filterId = `${id}-scene`;
      filters.push(filterMarkup(filterId, toBoundingBox(parts.join(""))));
      applied.push(filterId);
    }
    const foregroundTargets = new Map<HTMLElement, string>();
    const filteredAncestors = new Map<ForegroundLens, Lens[]>();
    const targets = orderForeground();
    const rank = new Map(targets.map((target, index) => [target, index]));
    targets.forEach((target) => {
      // An invisible surface, such as a trigger that became its menu, has no
      // content to refract.
      if (!target.w || !target.h || target.opacity < 0.001) return;
      const overlays = ordered.filter((lens) =>
        rank.get(target)! < rank.get(lens)! &&
        lens.maps && lens.opacity > 0.001 && overlaps(target, lens) && lens.absorbs?.element !== target.element &&
        !target.element.contains(lens.element) && !lens.element.contains(target.element) &&
        ![...filteredAncestors].some(([ancestor, applied]) => ancestor.element.contains(target.element) && applied.includes(lens)),
      );
      if (!overlays.length) return;
      const filterId = `${id}-f${target.serial}`;
      filters.push(foregroundFilter(filterId, target, overlays));
      foregroundTargets.set(target.element, filterId);
      filteredAncestors.set(target, overlays);
    });
    for (const element of foregroundStyles.keys()) if (!foregroundTargets.has(element)) restoreForeground(element);
    const liveId = patchFilters(defs, filters, mapUrl);
    for (const [element, filterId] of foregroundTargets) {
      if (!foregroundStyles.has(element)) foregroundStyles.set(element, element.style.filter);
      const next = [foregroundStyles.get(element), `url("#${liveId(filterId)}")`].filter(Boolean).join(" ");
      if (element.style.filter !== next) element.style.filter = next;
    }
    // A chain keeps every pass in the same CSS reference box. Nested filtered
    // elements change WebKit's reference bounds as preceding lenses overflow.
    surfaceFilters = applied.map((id) => `url("#${liveId(id)}")`).join(" ");
    notify();
  }
  /** Prepare maps for a shape an animation will pass through. Only resting
   * shapes are kept across loads; the rest render at once. */
  function prepare(l: Lens, g: MapGeometry, persist: boolean) {
    const key = mapKey(g);
    if (l.prepared.has(key) || l.preparing.has(key)) return;
    // Maps already decoded, or stored from an earlier load, apply at once, so
    // a path that starts on a surface's own shape begins on its own map.
    const settled = peekSurfaceMaterialMaps(g);
    if (settled) {
      const warm = warmer.has(settled);
      warmer.warm(settled);
      l.prepared.set(key, { geometry: g, maps: settled, ready: warm ? 0 : performance.now() + warmup });
      dirty = true;
      return;
    }
    l.preparing.add(key);
    pending++;
    getSurfaceMaterialMaps(g, persist)
      .then((maps) => {
        l.preparing.delete(key);
        if (!disposed && lenses.has(l) && l.path?.some((w) => mapKey({ ...w, dpr: g.dpr, appearance: g.appearance }) === key)) {
          const warm = warmer.has(maps);
          warmer.warm(maps);
          l.prepared.set(key, { geometry: g, maps, ready: warm ? 0 : performance.now() + warmup });
          dirty = true;
        }
      })
      .catch(() => { l.preparing.delete(key); })
      .finally(() => { pending--; ticker.wake(); });
  }
  /** Request maps for a lens geometry. Decoded maps already in the cache
   * apply at once, so a resting shape never waits a task for glass it has
   * shown before. Otherwise one request per lens is in flight; while geometry
   * keeps changing, the newest finished maps stretch to the current outline,
   * and the next request starts as soon as it resolves. */
  function request(l: Lens, g: MapGeometry, slice: boolean) {
    const key = slice ? mapKey(g) : JSON.stringify(g);
    l.wanted = key;
    if (key === l.key || l.inflight) return;
    const settled = slice ? peekSurfaceMaterialMaps(g) : peekMaterialMaps(g);
    if (settled && (warmer.has(settled) || !l.maps)) {
      l.key = key;
      warmer.warm(settled);
      l.maps = settled;
      l.shown = g;
      l.error = undefined;
      dirty = true;
      return;
    }
    l.key = key;
    l.inflight = true;
    pending++;
    (slice ? getSurfaceMaterialMaps(g) : getMaterialMaps(g))
      .then((maps) => {
        l.inflight = false;
        if (disposed || !lenses.has(l)) return;
        // Glass not yet showing waits for the shape it has since taken on
        // WebKit, where drawing the stale map first costs a frame of the
        // whole scene; elsewhere the early frame is cheap and reassuring.
        if (webkit && !l.maps && l.wanted !== key) { l.key = undefined; ticker.wake(); return; }
        const warm = warmer.has(maps);
        warmer.warm(maps);
        const apply = () => {
          if (disposed || !lenses.has(l)) return;
          l.maps = maps;
          l.shown = g;
          l.error = undefined;
          dirty = true;
          ticker.wake();
        };
        // Glass already showing keeps its map until the new one is warm.
        if (l.maps && !warm) setTimeout(apply, warmup); else apply();
      })
      .catch((e) => {
        l.inflight = false;
        if (!disposed && lenses.has(l) && l.key === key) {
          l.error = e instanceof Error ? e : new Error(String(e));
          notify(l.error);
        }
      })
      .finally(() => { pending--; ticker.wake(); });
  }
  /** One frame of the scene: advance animations, sample geometry, and plan
   * the writes that follow. Reads happen here; every style write and the
   * filter rebuild run in the shared write phase, after all tickers measured. */
  function tick(now: number) {
    if (disposed) return false;
    const writes: (() => void)[] = [];
    let busy = updateControlMotion(root, now);
    // Lenses are positioned in the content layer's space, which scrolls in flow layout.
    const r = (content ?? root).getBoundingClientRect();
    const contentWidth = content ? content.offsetWidth : root.clientWidth;
    const contentHeight = content ? content.offsetHeight : root.clientHeight;
    const size = `${contentWidth},${contentHeight}`;
    if (size !== lastSize) {
      dirty = true;
      lastSize = size;
    }
    // Advance every surface animation before any geometry is sampled.
    animators.forEach((animator) => { if (animator.frame(now, quiet)) busy = true; });
    lenses.forEach((l) => l.animators.forEach((animator) => { if (animator.frame(now, quiet)) busy = true; }));
    const holding = [...lenses].some((l) => l.outline?.pending());
    quiet = holding;
    const waypointKey = (l: Lens, w: LensWaypoint) =>
      mapKey({ width: w.width, height: w.height, radius: w.radius, outline: w.outline, dpr: w.dpr ?? motionDpr, appearance: l.options.appearance });
    /** Glass drawn in its place by another surface this frame, by how much. */
    const absorbed = new Map<Element, number>();
    const setClip = (l: Lens, clip: string) => {
      if (l.writtenClip === clip) return;
      l.writtenClip = clip;
      writes.push(() => { l.element.style.clipPath = clip; l.element.style.borderRadius = "0px"; });
    };
    const setRadius = (l: Lens, radius: string) => {
      if (l.writtenRadius === radius) return;
      l.writtenRadius = radius;
      writes.push(() => l.element.style.setProperty("--lg-radius", radius));
    };
    // Animated outlines choose what they draw before any opacity is decided,
    // since glass is only hidden once another surface draws in its place.
    lenses.forEach((l) => {
      l.place = undefined;
      const animated = l.outline?.geometry();
      if (!animated) return;
      // Maps for the path are prepared as it is planned, so the frames that
      // follow can blend between them instead of waiting on any of them.
      const waypoints = l.outline!.waypoints();
      if (waypoints !== l.path) {
        l.path = waypoints;
        const keep = new Set(waypoints.map((w) => waypointKey(l, w)));
        for (const [key, entry] of l.prepared) if (!keep.has(key) && entry.maps !== l.maps) l.prepared.delete(key);
        for (const w of waypoints) prepare(l, { width: w.width, height: w.height, radius: w.radius, outline: w.outline, dpr: w.dpr ?? motionDpr, appearance: l.options.appearance }, Boolean(w.resting));
      }
      const draw = animated.draw;
      if (!draw) return;
      const ready = (place: LensPlacement) => {
        const entry = l.prepared.get(waypointKey(l, place.shape));
        return entry && entry.ready <= now ? entry : undefined;
      };
      const placed = (place: LensPlacement, entry: PreparedMaps): Placed => ({ maps: entry.maps, x: place.left - r.left, y: place.top - r.top, w: place.width, h: place.height });
      let a = ready(draw.a), b = draw.b ? ready(draw.b) : a;
      // A shape whose maps are not ready yet shows the nearest prepared plain
      // one, stretched to the surface's own outline; a union that is not
      // ready leaves its glass in place and draws the surface on its own.
      let standIn = false;
      if (!a) {
        let score = Infinity;
        for (const entry of l.prepared.values()) {
          if (entry.geometry.outline || entry.ready > now) continue;
          const value = shapeDistance(entry.geometry, animated);
          if (value < score) { score = value; a = entry; }
        }
        standIn = true;
      }
      if (!a) return;
      const own = { shape: draw.a.shape, left: animated.left, top: animated.top, width: animated.width, height: animated.height };
      const first = standIn ? placed(own, a) : placed(draw.a, a);
      const second = !standIn && b && draw.b ? placed(draw.b, b) : first;
      l.place = { a: first, b: second, mix: second === first ? 0 : draw.mix, stretched: standIn || (!draw.a.shape.outline && !draw.b?.shape.outline) };
      if (animated.absorbs && !standIn) absorbed.set(animated.absorbs.element, Math.max(absorbed.get(animated.absorbs.element) ?? 0, animated.absorbs.weight));
    });
    lenses.forEach((l) => {
      const animated = l.outline?.geometry();
      const place = l.place;
      // In motion the lens covers whatever it draws this frame.
      const rect = place
        ? { left: Math.min(place.a.x, place.b.x) + r.left, top: Math.min(place.a.y, place.b.y) + r.top,
          width: Math.max(place.a.x + place.a.w, place.b.x + place.b.w) - Math.min(place.a.x, place.b.x),
          height: Math.max(place.a.y + place.a.h, place.b.y + place.b.h) - Math.min(place.a.y, place.b.y) }
        : animated ?? (({ left, top, width, height }) => ({ left, top, width, height }))(l.element.getBoundingClientRect());
      const x = rect.left - r.left,
        y = rect.top - r.top,
        w = rect.width,
        h = rect.height;
      if (
        [x - l.x, y - l.y, w - l.w, h - l.h].some((n) => Math.abs(n) > 0.05)
      ) {
        Object.assign(l, { x, y, w, h });
        dirty = true;
      }
      const opacity = effectiveOpacity(l.element, root) * (l.outline?.opacity() ?? 1) * (1 - (absorbed.get(l.element) ?? 0));
      if (Math.abs(opacity - l.opacity) > 0.001) { l.opacity = opacity; dirty = true; }
      const dpr = Math.min(devicePixelRatio || 1, 2);
      if (!animated) l.absorbs = undefined;
      if (animated) {
        busy = true;
        // The blend changes every frame, so the filter is rebuilt every frame.
        l.absorbs = animated.absorbs;
        if (place) {
          l.maps = place.a.maps;
          l.shown = l.prepared.get(waypointKey(l, animated.draw!.a.shape))?.geometry ?? l.shown;
        } else l.maps = undefined;
        dirty = true;
        // Content is clipped to the surface's own outline, never a union.
        const shown = place?.stretched ? l.shown : undefined;
        const box = l.element.getBoundingClientRect();
        const sx = (l.element.offsetWidth || 1) / (box.width || 1), sy = (l.element.offsetHeight || 1) / (box.height || 1);
        // Capsule maps are sliced, so they are exact at any width of their height.
        const exact = !shown || (shown.radius === "capsule" && animated.radius === "capsule" && Math.abs(shown.height - animated.height) < 0.5);
        const outline = exact ? { width: animated.width, height: animated.height, radius: animated.radius } : shown;
        const kx = animated.width / outline.width, ky = animated.height / outline.height;
        const points = shapePolygon(outline.width, outline.height, outline.radius)
          .map(([px, py]): ShapePoint => [(animated.left - box.left + px * kx) * sx, (animated.top - box.top + py * ky) * sy]);
        setClip(l, polygonClip(points));
        const radius = animated.radius === "capsule" ? Math.min(animated.width, animated.height) / 2 : animated.radius;
        setRadius(l, `${radius.toFixed(2)}px`);
        // Content never shows before the glass that holds it.
        const ready = l.maps ? "1" : "0";
        if (l.writtenReady !== ready) { l.writtenReady = ready; writes.push(() => l.element.style.setProperty("--lg-glass-ready", ready)); }
        l.geometryKey = undefined;
        l.key = undefined;
        return;
      }
      const { width, height } = getLayoutSize(l.element);
      if (!width || !height) return;
      const radius = l.options.radius ?? 8;
      const outline = l.resolveShape?.();
      if (l.resolveShape && (!outline || outline.length < 3)) {
        if (l.maps) { l.maps = undefined; dirty = true; }
        l.key = undefined;
        l.geometryKey = undefined;
        setResolvedShape(l.element, []);
        setClip(l, polygonClip([]));
        return;
      }
      setResolvedShape(l.element, outline);
      const g = {
        outline,
        width,
        height,
        radius,
        dpr,
        appearance: l.options.appearance,
      };
      // A capsule stretched unevenly keeps round ends in its content clip too.
      if (radius === "capsule" && !outline && Math.abs(w / width - h / height) > 0.004) {
        const points = shapePolygon(w, h, "capsule").map(([px, py]): ShapePoint => [px * width / w, py * height / h]);
        setClip(l, polygonClip(points));
        l.geometryKey = undefined;
        request(l, g, true);
        return;
      }
      const geometryKey = JSON.stringify(g);
      if (geometryKey !== l.geometryKey) {
        // A first measurement is not a resize: start with the exact map.
        if (l.geometryKey !== undefined) l.resized = now;
        l.geometryKey = geometryKey;
        setClip(l, outline ? polygonClip(outline) : shapeClip(width, height, radius));
        setRadius(l, `${typeof radius === "number" ? Math.min(radius, width/2, height/2) : Math.min(width,height)/2}px`);
      }
      // A capsule whose size is changing reuses one sliced map at every width;
      // at rest it uses an exact map, which draws with a quarter of the images.
      const resizing = radius === "capsule" && now - (l.resized ?? 0) < 500;
      if (resizing) busy = true;
      request(l, g, resizing);
    });
    foregrounds.forEach((target) => {
      const box = target.element.getBoundingClientRect();
      const next = { x: box.left - r.left, y: box.top - r.top, w: box.width, h: box.height };
      if (Object.entries(next).some(([key, value]) => Math.abs(value - target[key as "x" | "y" | "w" | "h"]) > 0.05)) {
        Object.assign(target, next);
        dirty = true;
      }
    });
    // CSS stacking can change without geometry changing, but only with the DOM.
    const paintOrder = orderForeground().map((target) => target.serial).join(",");
    if (paintOrder !== lastPaintOrder) { dirty = true; lastPaintOrder = paintOrder; }
    const changed = dirty;
    const moving = busy && now - composedAt < 15;
    const rebuild = dirty && !holding && !moving;
    if (rebuild) composedAt = now;
    if (!holding && !moving) dirty = false;
    // Scroll-edge regions are measured now; their filter joins the write.
    const blur = content ? progressive.update(content) : "";
    writes.push(() => {
      if (rebuild) compose(contentWidth, contentHeight);
      if (content) {
        const filters = [surfaceFilters, blur].filter(Boolean).join(" ");
        if (content.style.filter !== filters) content.style.filter = filters;
      }
    });
    return { active: busy || changed || pending > 0, write: () => { for (const write of writes) write(); } };
  }
  const ticker = createTicker(tick, {
    root,
    // The filters and the warmer are this scene's own output.
    ignore: (target) => svg.contains(target) || warmer.owns(target),
    onMutation: () => { structure++; },
  });
  return {
    setContent(element) {
      if (content) releaseContent(content);
      if (content) ticker.unobserve(content);
      content = element;
      // WebKit applies a reference filter again whenever the element paints,
      // which a popup, caret or highlight above it causes. A layer of its own
      // keeps the filtered result until the filter or the content changes.
      if (element && webkit && !element.style.willChange) element.style.willChange = "transform";
      if (element) ticker.observe(element);
      dirty = true;
      ticker.wake();
    },
    addSurface(element, options = {}) {
      if (lenses.size >= maxSurfaces)
        throw new RangeError(
          `GlassScene supports ${maxSurfaces} surfaces; increase maxSurfaces up to 64 or split the scene.`,
        );
      if (
        !Number.isFinite(options.refraction ?? 60) ||
        (options.refraction ?? 60) < 0
      )
        throw new RangeError("Refraction must be finite and nonnegative.");
      cornerOptions(options.radius ?? 8);
      const lens: Lens = { serial: ++lensSerial, element, options, resolveShape: options.concentric ? createConcentricResolver(element, typeof options.concentric === "object" ? options.concentric.inset : undefined, options.radius ?? 8) : undefined, releaseShape: registerShapeContainer(element, options.radius ?? 8), clip: element.style.clipPath, borderRadius: element.style.borderRadius, x: 0, y: 0, w: 0, h: 0, opacity: 1, animators: [], prepared: new Map(), preparing: new Set() };
      const motion = () => resolveMotion(options.motion);
      // Container-relative outlines follow their parent; they do not travel.
      if ((options.morphFrom || options.fluid) && !options.concentric)
        lens.animators.push(lens.outline = attachGeometryMotion(element, {
          from: options.morphFrom, morph: options.morph, layout: options.fluid, radius: options.radius ?? 8, motion, neck: options.neck, enter: options.morphEnter,
          prepared: (shape) => { const entry = lens.prepared.get(mapKey({ width: shape.width, height: shape.height, radius: shape.radius, outline: shape.outline, dpr: shape.dpr ?? motionDpr, appearance: options.appearance })); return Boolean(entry) && entry!.ready <= performance.now(); },
        }));
      if (options.interactive) {
        lens.animators.push(attachInteraction(element, motion));
        if (element.dataset.glassInteractive !== "") element.dataset.glassInteractive = "";
      }
      // Attributes the React layer already rendered are left untouched: a
      // rewrite during mount forces a style recalc before the next read.
      const previousAppearance = element.getAttribute("data-glass-appearance");
      if (previousAppearance !== (options.appearance ?? "light")) element.dataset.glassAppearance = options.appearance ?? "light";
      lenses.add(lens);
      ticker.observe(element);
      structure++;
      dirty = true;
      // A popup raises its scene above sibling scenes while it is present.
      if (options.morphFrom) { popups++; root.dataset.glassPopup = ""; }
      ticker.wake();
      return () => {
        lens.animators.forEach((animator) => animator.dispose());
        if (options.interactive) delete element.dataset.glassInteractive;
        setResolvedShape(element);
        lens.releaseShape();
        restoreForeground(element);
        element.style.clipPath = lens.clip;
        element.style.borderRadius = lens.borderRadius;
        element.style.removeProperty("--lg-radius");
        lenses.delete(lens);
        structure++;
        ticker.unobserve(element);
        if (options.morphFrom && --popups === 0) delete root.dataset.glassPopup;
        if (previousAppearance === null) element.removeAttribute("data-glass-appearance");
        else element.setAttribute("data-glass-appearance", previousAppearance);
        dirty = true;
        ticker.wake();
      };
    },
    addForeground(element) {
      const target = { element, serial: ++lensSerial, x: 0, y: 0, w: 0, h: 0, opacity: 1, options: {} };
      foregrounds.add(target);
      structure++;
      ticker.observe(element);
      dirty = true;
      ticker.wake();
      return () => {
        restoreForeground(element);
        foregrounds.delete(target);
        structure++;
        ticker.unobserve(element);
        dirty = true;
        ticker.wake();
      };
    },
    addAnimator(animator) {
      animators.add(animator);
      ticker.wake();
      return () => { animators.delete(animator); animator.dispose(); ticker.wake(); };
    },
    addProgressiveBlur: (element, options) => { const remove = progressive.add(element, options); ticker.wake(); return () => { remove(); ticker.wake(); }; },
    addScrollEdges: (options) => { const remove = progressive.addScroll(options); ticker.wake(); return () => { remove(); ticker.wake(); }; },
    dispose() {
      clearTimeout(warmRenderer);
      progressive.dispose();
      warmer.dispose();
      animators.forEach((animator) => animator.dispose());
      animators.clear();
      disposed = true;
      ticker.dispose();
      if (content) releaseContent(content);
      for (const element of foregroundStyles.keys()) restoreForeground(element);
      svg.remove();
      lenses.forEach((lens) => { lens.animators.forEach((animator) => animator.dispose()); setResolvedShape(lens.element); lens.releaseShape(); lens.element.style.clipPath = lens.clip; lens.element.style.borderRadius = lens.borderRadius; lens.element.style.removeProperty("--lg-radius"); });
      lenses.clear();
      foregrounds.clear();
    },
  };
}

export { registerShapeContainer, observeConcentricShape, observeCornerPlacement } from "./shape-layout.js";
export type { ConcentricOptions, CornerOptions, GlassCornerPosition } from "./shape-layout.js";
