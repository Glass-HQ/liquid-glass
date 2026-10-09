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
import { createMapWarmer, mapWarmup as warmup } from "./warm.js";
import { updateControlMotion } from "./control-motion.js";
import { createProgressiveLayer } from "./progressive.js";
import type { ScrollEdgesOptions } from "./progressive.js";
import type { ProgressiveBlurOptions } from "../core/progressive.js";
export type { ScrollEdgesOptions, GlassScrollTarget } from "./progressive.js";
import { crossedSides, edgeTiles, filterBounds, tilesFor } from "./filter-bounds.js";
import { blurOutsets, filterBudgetFactor, filterGraphOutsets, webkit } from "./filter-budget.js";
import { clusterFilterBranches, mapBoxesOverlap } from "./filter-groups.js";
import { compoundFieldImage, compoundSources, fieldTouches } from "./compound-field.js";
import { refractionSamplingBounds, unionSamplingBounds } from "./sampling-bounds.js";
import { sharedBackdropMaterials } from "./shared-backdrop.js";
import { gecko } from "./filter-stages.js";
import { createLensLayers } from "./lens-layers.js";
import type { LayerFrame, LayerLens } from "./lens-layers.js";
import { composeSparseLayers } from "./compose-layers.js";
import { acquireFilterPaintRoot, acquireSceneCompositingLayer } from "./filter-paint-root.js";
import type { FilterBounds } from "./filter-bounds.js";
import { materials } from "../core/materials.js";
import { frostMarkup, overlayTintMarkup, tintChannels, tintMarkup, toneMarkup } from "./material-graph.js";
import type { MaterialOptions } from "../core/materials.js";
import { getMaterialMaps, getSurfaceMaterialMaps, peekMaterialMaps, peekSurfaceMaterialMaps } from "./maps.js";
import { getMaterialRenderer } from "../gpu/index.js";
import { capsuleMapGeometry, mapImage, mapUrl, surfaceMapResult } from "./map-image.js";
import { blendMapImage } from "./map-blend.js";
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
  /** Optional transparent, nested filter hosts in inner-to-outer order.
   * Gecko uses separate hosts for graphs exceeding its operation limit;
   * reserve the final host for progressive blur. */
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
  /** Where the surface's own glass layer is drawn, in Gecko. */
  frame?: LayerFrame;
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
  baseOpacity?: number;
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
  const releaseSceneLayer = webkit ? acquireSceneCompositingLayer(root) : undefined;
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
  let filterError: Error | undefined;
  let progressiveFilterError: Error | undefined;
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
    error ??= filterError ?? progressiveFilterError ?? [...lenses].find((l) => l.error)?.error;
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
  let progressiveOutsets = 0;
  /** Gecko draws each surface's glass in a layer of its own. */
  const layers = gecko ? createLensLayers(root) : undefined;
  let contentRect = { left: 0, top: 0, width: 0, height: 0 };
  let lastPaintOrder = "";
  interface FilterStyle { original: string; base: string; priority: string; applied?: string; releasePaint?: () => void }
  const retainFilter = (element: HTMLElement): FilterStyle => {
    const original = element.style.getPropertyValue("filter");
    // CSS-wide keywords cannot be concatenated with filter functions. Keep
    // the authored declaration for cleanup and compose its resolved value.
    const base = /^(initial|inherit|unset|revert|revert-layer)$/i.test(original.trim()) ? getComputedStyle(element).filter : original;
    return { original, base, priority: element.style.getPropertyPriority("filter"), releasePaint: webkit ? acquireFilterPaintRoot(element) : undefined };
  };
  const applyFilter = (element: HTMLElement, style: FilterStyle, filters: string) => {
    const original = style.base.trim().toLowerCase() === "none" ? "" : style.base;
    const next = filters ? [original, filters].filter(Boolean).join(" ") : style.original;
    if (element.style.getPropertyValue("filter") !== next || element.style.getPropertyPriority("filter") !== style.priority)
      element.style.setProperty("filter", next, style.priority);
    style.applied = element.style.getPropertyValue("filter");
  };
  const releaseFilter = (element: HTMLElement, style: FilterStyle) => {
    if (style.applied !== undefined && element.style.getPropertyValue("filter") === style.applied && element.style.getPropertyPriority("filter") === style.priority) {
      if (style.original) element.style.setProperty("filter", style.original, style.priority);
      else element.style.removeProperty("filter");
    }
    style.releasePaint?.();
  };
  let contentStyle: FilterStyle | undefined;
  /** In Gecko, progressive blur draws on a wrapper around the content, so
   * glass layers can copy the content without rendering its blur. */
  let blurHost: { element: HTMLElement; style: FilterStyle; matches?: boolean } | undefined;
  let blurKey = "";
  const foregroundStyles = new Map<HTMLElement, FilterStyle>();
  const foregrounds = new Set<ForegroundLens & { serial: number }>();
  const releaseContent = (element: HTMLElement) => {
    if (contentStyle) releaseFilter(element, contentStyle);
    if (blurHost) { releaseFilter(blurHost.element, blurHost.style); blurHost.element.removeAttribute("data-glass-blur-active"); }
    blurHost = undefined;
    contentStyle = undefined;
  };
  const restoreForeground = (element: HTMLElement) => {
    const original = foregroundStyles.get(element);
    if (original !== undefined) {
      releaseFilter(element, original);
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
  const blurOf = (l: Lens, soften: number) => {
    const regular = l.options.material === "regular";
    return regular ? Math.max(materials.regular.blur, (l.options.appearance === "dark" ? materials.regular.dark : materials.regular.light).fillSigma) * soften : 0;
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
      if (contentStyle) applyFilter(content, contentStyle, "");
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
    const paired = webkit ? compoundSources(ordered, {
      source: (l) => l.outline?.detachedSource(),
      nested: (l) => parentsOf(l).length > 0,
      refraction: (l) => refractionOf(l, parentsOf(l)),
      reach: (l) => Math.ceil(3 * blurOf(l, 1) + refractionOf(l, parentsOf(l)) + 8) + 2,
    }) : new Map<Lens, Lens>();
    const pairedSources = new Set(paired.values());
    const compoundOf = (unit: readonly Lens[]) => unit.length === 2 && paired.get(unit[1]!) === unit[0]
      ? { source: unit[0]!, popup: unit[1]! } : undefined;
    const drawn = ordered.filter((l) => l.maps && (l.opacity >= 0.001 || pairedSources.has(l)));
    const parents = new Map(drawn.map((l) => [l, parentsOf(l)] as const));
    const wanted = new Map(drawn.map((l) => [l, refractionOf(l, parents.get(l)!)] as const));
    // Glass shows other glass when it overlaps it or bends it in from its
    // rim; a frosted blur reaching further adds only a faint tint, not worth
    // a shared full-size pass on every frame.
    const reach = (l: Lens) => wanted.get(l)! + 4;
    const touches = (a: Lens, b: Lens) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const near = (a: Lens, b: Lens) => {
      const r = Math.max(reach(a), reach(b));
      return a.x < b.x + b.w + r && b.x - r < a.x + a.w && a.y < b.y + b.h + r && b.y - r < a.y + a.h;
    };
    // WebKit adds up the outsets of every branch of a filter's graph, not
    // only along its deepest path, and sizes its buffer by the sum. Each
    // surface drawn as its own branch costs a full lens of outsets there, so
    // opaque surfaces of one material that neither touch nor neighbor
    // other glass share a branch: their maps and masks merge into one set of
    // images, which a single material pass refracts. Elsewhere a shared
    // branch only spreads its passes over the empty space between surfaces.
    const branchKey = (l: Lens) => `${l.options.material ?? "clear"},${l.options.appearance ?? "light"},${l.options.tint ?? ""},${wanted.get(l)}`;
    const independent = (l: Lens) => webkit && l.opacity >= 0.999 && !parents.get(l)!.length;
    // Neighbors drawn in the same pass need no finished glass of each other.
    const shareable = (l: Lens) => independent(l) && !drawn.some((other) =>
      other !== l && near(l, other) && (!independent(other) || branchKey(other) !== branchKey(l) || mapBoxesOverlap(l, other)));
    let units: Lens[][] = [];
    const sharedUnits = new Map<string, Lens[]>();
    for (const l of drawn) {
      if (pairedSources.has(l)) continue;
      const source = paired.get(l);
      if (source) { units.push([source, l]); continue; }
      if (!shareable(l)) { units.push([l]); continue; }
      const key = branchKey(l);
      let unit = sharedUnits.get(key);
      if (!unit) { unit = []; sharedUnits.set(key, unit); units.push(unit); }
      unit.push(l);
    }
    const materialGroupOf = new Map(units.flatMap((unit) => unit.map((l) => [l, unit] as const)));
    const scale = typeof devicePixelRatio === "number" && devicePixelRatio > 0 ? devicePixelRatio : 1;
    const outsetsOf = new Map(drawn.map((l) => {
      const spec = l.options.appearance === "dark" ? materials.regular.dark : materials.regular.light;
      const blur = l.options.material === "regular" ? blurOutsets(materials.regular.blur) + blurOutsets(spec.fillSigma) : 0;
      return [l, scale * (blur + wanted.get(l)!)] as const;
    }));
    // A branch samples the finished layers of the glass it touches, which
    // adds their outsets to its own.
    const outsetsFor = (groups: readonly Lens[][]) => groups.reduce((sum, unit) => sum + Math.max(...unit.map((l) => outsetsOf.get(l)!))
      + (unit.length === 1 || compoundOf(unit) ? drawn.filter((other) => !unit.includes(other) && unit.some((member) => touches(other, member))).reduce((most, other) => Math.max(most, outsetsOf.get(other)!), 0) : 0), 0);
    const soften = filterBudgetFactor(width * scale, height * scale, outsetsFor(units));
    const amounts = new Map(drawn.map((l) => [l, wanted.get(l)! * soften] as const));
    const sampling = new Map(drawn.map((l) => {
      const place = l.place;
      // Ordinary outlines refract inward. Distinct map rectangles and custom
      // outlines retain full reach: a transparent map crossfade can change
      // its unpremultiplied displacement channels through quantization.
      const symmetric = !paired.has(l) && !pairedSources.has(l) && (place
        ? place.stretched && place.a.x === place.b.x && place.a.y === place.b.y && place.a.w === place.b.w && place.a.h === place.b.h
        : Boolean(l.shown && !l.shown.outline));
      return [l, refractionSamplingBounds({ x: l.x - 2, y: l.y - 2, width: l.w + 4, height: l.h + 4 }, amounts.get(l)!, symmetric)] as const;
    }));
    // Every surface samples its own padded crop; shared intermediates only
    // need to cover the crops of the surfaces that read them.
    const cropOf = (l: Lens) => {
      const padding = Math.ceil(3 * blurOf(l, soften) + amounts.get(l)! + 8);
      return { x: l.x - 2 - padding, y: l.y - 2 - padding, width: l.w + 4 + 2 * padding, height: l.h + 4 + 2 * padding };
    };
    const clustered = units.flatMap((unit) => {
      if (unit.length < 2 || compoundOf(unit)) return [unit];
      const regular = unit[0]!.options.material === "regular";
      const tinted = /^#[\da-f]{6}$/i.test(unit[0]!.options.tint ?? "");
      return clusterFilterBranches(unit, (l) => {
        const output = { x: l.x - 2, y: l.y - 2, width: l.w + 4, height: l.h + 4 };
        const reach = amounts.get(l)! + 3;
        return { output, crop: cropOf(l), sampled: { x: output.x - reach, y: output.y - reach, width: output.width + 2 * reach, height: output.height + 2 * reach } };
      }, { output: (regular ? 4 : 3) + (tinted ? 3 : 0), sampled: regular ? 4 : 0 });
    });
    // Splitting sparse groups must not soften the glass to fit more outsets.
    // Keep the original grouping when WebKit's buffer budget needs it.
    if (!gecko && filterBudgetFactor(width * scale, height * scale, outsetsFor(clustered)) >= soften) units = clustered;
    const unitName = (unit: readonly Lens[]) => unit.length > 1 ? `g${unit.map((member) => member.serial).sort((a, b) => a - b).join("-")}` : `s${unit[0]!.serial}`;
    const crops = drawn.map(cropOf);
    const unionOf = (boxes: readonly FilterBounds[]): FilterBounds => {
      const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
      return { x, y, width: Math.max(...boxes.map((b) => b.x + b.width)) - x, height: Math.max(...boxes.map((b) => b.y + b.height)) - y };
    };
    const bounds = filterBounds(width, height, crops, 0);
    const region = (box: FilterBounds) => `x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}"`;
    // Edge pixels are repeated only past the sides some surface samples
    // beyond; glass well inside its content reads the source directly.
    // WebKit only needs edge extension when the actual surface leaves the
    // content. Tiling the blur padding of full-height panels can exceed its
    // software buffer even though the visible surface stays inside.
    const buildStage = (stageUnits: readonly Lens[][]) => {
      const unitOf = new Map(stageUnits.flatMap((unit) => unit.map((l) => [l, unit] as const)));
      const tiles = stageUnits.length ? edgeTiles(width, height, bounds, "scene", crossedSides(width, height, stageUnits.flat().map((l) => webkit ? { x: l.x, y: l.y, width: l.w, height: l.h } : cropOf(l)))) : { markup: "", names: {} };
      const parts: string[] = [tiles.markup];
      const source = "SourceGraphic";
      const beneathOf = new Map(stageUnits.map((unit, index) => {
        const lens = compoundOf(unit)?.popup ?? unit[0]!;
        const beneath = unit.length > 1 && !compoundOf(unit) ? [] : stageUnits.slice(0, index).flat().filter((earlier) =>
          materialGroupOf.get(earlier) !== materialGroupOf.get(lens) &&
          unit.some((member) => fieldTouches(earlier, member, reach(lens))));
        return [unit, beneath] as const;
      }));
      const shared = webkit ? sharedBackdropMaterials(stageUnits.map((unit) => ({
        key: unit, id: unitName(unit), options: (compoundOf(unit)?.popup ?? unit[0]!).options,
        bounds: unionSamplingBounds(unit.map((member) => sampling.get(member)!)), inputs: beneathOf.get(unit)!,
      })), soften) : undefined;
      const emitted = new Set<string>();
      // Every input a surface reads is a realized image: the source, edge
      // tiles, map images, and the finished layers of glass it overlaps. A
      // finished layer read by a second consumer with different bounds is
      // evaluated again from its blurs up, so glass merely near another
      // surface takes only that surface's rim and light images instead.
      const layersOf = new Map<Lens[], string[]>();
      const maskOf = new Map<Lens[], string>();
      stageUnits
        .forEach((unit) => {
          // The first surface of a shared branch stands for all: they share
          // material, appearance, tint, and refraction.
          const compound = compoundOf(unit);
          const l = compound?.popup ?? unit[0]!;
          const o = l.options,
            // Names follow the surface, not its position, so primitives persist
            // as other surfaces enter and leave the scene. A shared identity
            // comes directly from its unique members, without retaining old groups.
            p = unitName(unit);
          const box = unionOf(unit.map((member) => ({ x: member.x - 2, y: member.y - 2, width: member.w + 4, height: member.h + 4 })));
          const x = box.x,
            y = box.y,
            w = box.width,
            h = box.height;
          /** A resting surface draws its map in its box. In motion it draws the
           * two prepared shapes around the frame, each in its own box, blended;
           * the structure stays the same for every frame of the motion, so the
           * retained filter only changes attributes. A shared branch merges the
           * images of its surfaces into one. */
          const image = (plane: MapPlane, result: string) => {
            const memberImage = (member: Lens, name: string, imagePlane: MapPlane = plane) => {
              const place = member.place;
              if (!place) return mapImage(member.maps!, imagePlane, name, member.x - 2, member.y - 2, member.w + 4, member.h + 4);
              return blendMapImage(imagePlane, name, place, member, gecko);
            };
            if (compound) return compoundFieldImage(compound.source, compound.popup, plane, result, box,
              (member, imagePlane, name) => memberImage(member, name, imagePlane));
            if (unit.length === 1) return memberImage(l, result);
            // Keep each image's singleton identity when group membership
            // changes. Reloading unchanged maps here can stall and flash the
            // entire content filter when a popup absorbs its source glass.
            return unit.map((member) => memberImage(member, surfaceMapResult(member.serial, plane))).join("")
              + `<feMerge result="${result}" ${region(box)}>${unit.map((member) => `<feMergeNode in="${surfaceMapResult(member.serial, plane)}"/>`).join("")}</feMerge>`;
          };
          const opaque = unit.length > 1 || l.opacity >= 0.999;
          const first = parts.length;
          // The field displaces with its red and green channels and covers
          // the shape with its alpha, which a fading surface scales.
          parts.push(
            image("field", `${p}field`),
            ...(opaque ? [] : [`<feComponentTransfer in="${p}field" result="${p}mask"><feFuncA type="linear" slope="${l.opacity}"/></feComponentTransfer>`]),
          );
          const mask = opaque ? `${p}field` : `${p}mask`;
          const nested = parents.get(l)!;
          // Keep blur intermediates local to the lens, including its sampling
          // margin. Full-scene intermediates exceed WebKit's filter budget.
          const crop = unionOf(unit.map(cropOf));
          // Surfaces of a shared branch have no glass near them.
          const beneath = beneathOf.get(unit)!;
          const inputs: string[] = [];
          for (const earlier of beneath) {
            const touching = unit.some((member) => fieldTouches(earlier, member));
            if (touching) inputs.push(...layersOf.get(unitOf.get(earlier)!)!);
            else {
              const q = `s${earlier.serial}`;
              parts.push(mapImage(earlier.maps!, "overlay", `${p}by${q}overlay`, earlier.x - 2, earlier.y - 2, earlier.w + 4, earlier.h + 4));
              inputs.push(`${p}by${q}overlay`);
            }
          }
          const edges = tilesFor(width, height, crop).map((key) => tiles.names[key]).filter((name): name is string => Boolean(name));
          // Glass well inside its content reads the source directly. Only a
          // surface past the content's edge or above other glass gathers its
          // backdrop into a cropped merge, which software filters pay for.
          if (edges.length || inputs.length)
            parts.push(`<feMerge result="${p}crop" ${region(crop)}>${edges.map((n) => `<feMergeNode in="${n}"/>`).join("")}<feMergeNode in="${source}"/>${inputs.map((n) => `<feMergeNode in="${n}"/>`).join("")}</feMerge>`);
          const cropped = edges.length || inputs.length ? `${p}crop` : source;
          let base = cropped;
          if (o.material === "regular") {
            const backdrop = shared?.get(unit);
            if (backdrop) {
              if (!emitted.has(backdrop.result)) { parts.push(backdrop.markup); emitted.add(backdrop.result); }
              base = backdrop.result;
            } else {
              const frost = frostMarkup(p, cropped, o, soften);
              parts.push(frost.markup);
              base = frost.result;
            }
          }
          const amount = amounts.get(l)!;
          // Blur needs the sampling neighborhood, while pointwise tone and
          // chroma only need the pixels that refraction delivers to the lens.
          parts.push(
            `<feDisplacementMap in="${base}" in2="${p}field" scale="${amount * 2}" xChannelSelector="R" yChannelSelector="G" result="${p}refracted"/>`,
            toneMarkup(p, o, nested.length > 0),
          );
          let color = `${p}color`;
          let overlay = `${p}overlay`;
          const tint = tintChannels(o);
          if (tint) {
            const tinted = tintMarkup(p, o, tint);
            parts.push(tinted.markup);
            color = tinted.color;
            overlay = `${p}tintOverlay`;
          }
          parts.push(
            `<feComposite in="${color}" in2="${mask}" operator="in" result="${p}inside"/>`,
            image("overlay", `${p}overlay`),
            ...(tint ? [overlayTintMarkup(`${p}overlay`, overlay, o, tint)] : []),
            // Fully opaque glass needs no opacity pass over its rim and light.
            ...(opaque ? [] : [`<feComponentTransfer in="${overlay}" result="${p}fadedOverlay"><feFuncA type="linear" slope="${l.opacity}"/></feComponentTransfer>`]),
          );
          // Without a subregion every primitive covers the whole filter region,
          // the scene plus padding. Only the surface's box matters, plus the
          // reach of its displacement for the material it samples.
          const reachBox = unionSamplingBounds(unit.map((member) => sampling.get(member)!));
          const sampledStages = new Set(["frost", "fill", "blend", "mix"].map((name) => `${p}${name}`));
          for (let index = first; index < parts.length; index++)
            parts[index] = parts[index]!.replace(/<(feFlood|feComposite|feDisplacementMap|feColorMatrix|feComponentTransfer|feGaussianBlur|feBlend)\b([^>]*?)(\/?)>/g,
              (tag, name: string, attributes: string, close: string) => {
                if (/\sx="/.test(attributes)) return tag;
                const region = sampledStages.has(/result="([^"]+)"/.exec(attributes)?.[1] ?? "") ? reachBox : { x, y, width: w, height: h };
                return `<${name}${attributes} x="${region.x}" y="${region.y}" width="${region.width}" height="${region.height}"${close}>`;
              });
          const layer = [`${p}inside`, opaque ? overlay : `${p}fadedOverlay`];
          layersOf.set(unit, layer);
          maskOf.set(unit, mask);
        });
      // Replace covered input, rather than painting a sparse refracted copy
      // over its sharp original. Remove covered source pixels even when the
      // DOM backdrop is transparent. Sparse contributions preserve alpha and
      // paint order with one full-scene pass, however many surfaces there are.
      if (stageUnits.length) {
        parts.push(composeSparseLayers(stageUnits.map((unit) => ({
          id: unitName(unit), mask: maskOf.get(unit)!, layers: layersOf.get(unit)!,
          bounds: unionSamplingBounds(unit.map((l) => ({ x: l.x - 2, y: l.y - 2, width: l.w + 4, height: l.h + 4 }))),
        }))));
      }
      return parts.join("");
    };
    filterError = undefined;
    if (layers) {
      // Every surface draws its own glass; the content keeps only passes
      // Gecko renders on the GPU.
      const layered = new Map(drawn.filter((l) => l.frame).map((l) => [l, {
        serial: l.serial, element: l.element, options: l.options, maps: l.maps!, place: l.place,
        x: l.x, y: l.y, w: l.w, h: l.h, opacity: l.opacity, refraction: wanted.get(l)!, frame: l.frame!,
        parents: [] as LayerLens[], beneath: [] as LayerLens[],
      } satisfies LayerLens] as const));
      for (const [l, layer] of layered) {
        layer.parents.push(...parents.get(l)!.map((parent) => layered.get(parent)).filter((parent) => parent !== undefined));
        for (const earlier of drawn) {
          if (earlier === l) break;
          const below = layered.get(earlier);
          if (below && !layer.parents.includes(below) && !l.element.contains(earlier.element) && fieldTouches(earlier, l, reach(l))) layer.beneath.push(below);
        }
      }
      layers.update([...layered.values()], content, contentRect, blurHost?.matches ? { left: 0, top: 0, regions: progressive.regions() } : undefined);
    } else if (drawn.length) {
      let primitives = buildStage(units);
      if (webkit) {
        const own = filterGraphOutsets(primitives);
        const total = own + progressiveOutsets;
        const budget = filterBudgetFactor(width * scale, height * scale, total * scale);
        const factor = own ? Math.max(0, Math.min(1, (total * budget - progressiveOutsets) / own)) : 1;
        if (factor < 1) primitives = primitives.replace(/(<fe(?:GaussianBlur|DisplacementMap)\b[^>]*?\s(?:stdDeviation|scale)=")([^"]+)(")/g,
          (_, before: string, value: string, after: string) => before + value.split(" ").map((part) => Number(part) * factor).join(" ") + after);
      }
      const filterId = `${id}-scene`;
      filters.push(`<filter id="${filterId}" x="${bounds.x / width}" y="${bounds.y / height}" width="${bounds.width / width}" height="${bounds.height / height}" filterUnits="objectBoundingBox" primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB">${primitives}</filter>`);
      applied.push(filterId);
    }
    const foregroundTargets = new Map<HTMLElement, string>();
    const filteredAncestors = new Map<ForegroundLens, Lens[]>();
    const targets = orderForeground();
    const rank = new Map(targets.map((target, index) => [target, index]));
    // Gecko's layers already refract the glass beneath them.
    if (!layers) targets.forEach((target) => {
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
      if (!foregroundStyles.has(element)) foregroundStyles.set(element, retainFilter(element));
      applyFilter(element, foregroundStyles.get(element)!, `url("#${liveId(filterId)}")`);
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
    contentRect = { left: 0, top: 0, width: r.width, height: r.height };
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
      if (layers) {
        // The surface's screen box and the scale its transforms apply, so its
        // glass layer can draw the content under it in its own space.
        const box = l.element.getBoundingClientRect();
        // Positions are relative to the content, so page scrolling changes nothing.
        const frame = { left: box.left - r.left, top: box.top - r.top, sx: box.width / (l.element.offsetWidth || box.width || 1), sy: box.height / (l.element.offsetHeight || box.height || 1), clientLeft: l.element.clientLeft, clientTop: l.element.clientTop };
        if (!l.frame || Object.entries(frame).some(([key, value]) => Math.abs(value - l.frame![key as keyof LayerFrame]) > 0.01)) dirty = true;
        l.frame = frame;
      }
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
      l.baseOpacity = effectiveOpacity(l.element, root) * (l.outline?.opacity() ?? 1);
      const opacity = l.baseOpacity * (1 - (absorbed.get(l.element) ?? 0));
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
      // Placement can change the popup's intrinsic size. Its path prepares
      // the final maps once positioned; intermediate hidden boxes are unused.
      if (l.outline?.positioning()) return;
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
    // The wrapper draws the content's blur only where it has the content's box.
    if (blurHost) {
      const box = blurHost.element.getBoundingClientRect();
      blurHost.matches = Math.abs(box.left - r.left) < 0.5 && Math.abs(box.top - r.top) < 0.5 && Math.abs(box.width - r.width) < 0.5 && Math.abs(box.height - r.height) < 0.5;
    }
    const blur = content ? progressive.update(content) : "";
    // Layers apply the same regions themselves.
    if (blurHost) {
      const key = JSON.stringify([blurHost.matches, progressive.regions()]);
      if (key !== blurKey) { blurKey = key; dirty = true; }
    }
    const nextOutsets = progressive.outsets();
    if (nextOutsets !== progressiveOutsets) { progressiveOutsets = nextOutsets; dirty = true; }
    const changed = dirty;
    const moving = busy && now - composedAt < 15;
    const rebuild = dirty && !holding && !moving;
    if (rebuild) composedAt = now;
    if (!holding && !moving) dirty = false;

    const nextProgressiveError = progressive.error();
    const progressiveErrorChanged = progressiveFilterError?.message !== nextProgressiveError?.message;
    progressiveFilterError = nextProgressiveError;
    writes.push(() => {
      if (rebuild) compose(contentWidth, contentHeight);
      if (content) {
        const filters = blurHost?.matches ? surfaceFilters : (progressive.scrollsContent() ? [blur, surfaceFilters] : [surfaceFilters, blur]).filter(Boolean).join(" ");
        if (contentStyle) applyFilter(content, contentStyle, filters);
        if (blurHost) applyFilter(blurHost.element, blurHost.style, blurHost.matches ? blur : "");
      }
      if (progressiveErrorChanged) notify();
    });
    return { active: busy || changed || pending > 0, write: () => { for (const write of writes) write(); } };
  }
  const ticker = createTicker(tick, {
    root,
    // The filters and the warmer are this scene's own output.
    ignore: (target) => svg.contains(target) || warmer.owns(target) || Boolean(layers?.owns(target)),
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
      if (element) contentStyle = retainFilter(element);
      const host = element?.parentElement;
      if (layers && host?.hasAttribute("data-glass-blur-host")) {
        host.setAttribute("data-glass-blur-active", "");
        blurHost = { element: host, style: retainFilter(host) };
      }
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
          submenu: element.hasAttribute("data-glass-submenu"),
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
      layers?.dispose();
      warmer.dispose();
      animators.forEach((animator) => animator.dispose());
      animators.clear();
      disposed = true;
      ticker.dispose();
      if (content) releaseContent(content);
      for (const element of foregroundStyles.keys()) restoreForeground(element);
      svg.remove();
      releaseSceneLayer?.();
      lenses.forEach((lens) => { lens.animators.forEach((animator) => animator.dispose()); setResolvedShape(lens.element); lens.releaseShape(); lens.element.style.clipPath = lens.clip; lens.element.style.borderRadius = lens.borderRadius; lens.element.style.removeProperty("--lg-radius"); });
      lenses.clear();
      foregrounds.clear();
    },
  };
}

export { registerShapeContainer, observeConcentricShape, observeCornerPlacement } from "./shape-layout.js";
export type { ConcentricOptions, CornerOptions, GlassCornerPosition } from "./shape-layout.js";
