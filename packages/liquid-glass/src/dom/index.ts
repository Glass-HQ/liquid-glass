import { polygonClip } from "../core/concentric.js";
import type { ShapePoint } from "../core/concentric.js";
import {
  createConcentricResolver,
  setResolvedShape,
  registerShapeContainer,
} from "./shape-layout.js";
import { getLayoutSize } from "./layout-size.js";
import { shapeClip, shapePolygon, cornerOptions } from "../core/shape.js";
import { attachInteraction, resolveMotion } from "./interaction.js";
import type { GlassMotion, SurfaceAnimator } from "./interaction.js";
export { attachInteraction, resolveMotion } from "./interaction.js";
export type { GlassMotion, SurfaceAnimator } from "./interaction.js";
export { attachSelectionLens } from "./selection.js";
export type { SelectionLens } from "./selection.js";
import { comparePaintOrder, foregroundFilter, overlaps } from "./foreground.js";
import type { ForegroundLens } from "./foreground.js";
import { patchFilters } from "./filter-patch.js";
import { createMapWarmer, mapWarmup as warmup, warmDocumentStyle } from "./warm.js";
import { updateControlMotion } from "./control-motion.js";
import { createProgressiveLayer } from "./progressive.js";
import type { ScrollEdgesOptions } from "./progressive.js";
import type { ProgressiveBlurOptions } from "../core/progressive.js";
export type { ScrollEdgesOptions, GlassScrollTarget } from "./progressive.js";
import { crossedSides, edgeTiles, filterBounds, tilesFor } from "./filter-bounds.js";
import {
  blurOutsets,
  filterBudgetFactor,
  filterGraphOutsets,
  outsetBudget,
  webkit,
} from "./filter-budget.js";
import { padRepaintReach, repaintReach, tiledReach } from "./filter-reach.js";
import { filterPixelRatio, pageZoom, untiledOutsets } from "./page-zoom.js";
import { clusterFilterBranches, mapBoxesOverlap } from "./filter-groups.js";
import { refractionSamplingBounds, unionSamplingBounds } from "./sampling-bounds.js";
import { sharedBackdropMaterials } from "./shared-backdrop.js";
import { gecko } from "./filter-stages.js";
import { chromium } from "./engine.js";
import { backdropGlassFilter, backdropGlassShadow } from "./backdrop-glass.js";
import { hexTint, resolveTint } from "./tint-color.js";
import type { LayerFrame, LayerLens, LensLayers } from "./lens-layers.js";
import { composeSparseLayers } from "./compose-layers.js";
import { acquireFilterPaintRoot, acquireSceneCompositingLayer } from "./filter-paint-root.js";
import { registerSceneRoot, releaseFilterPart, sceneDepth, setFilterPart } from "./filter-chain.js";
import type { LayerBox } from "./composited.js";
import type { EscapedLayers, LayerGlass } from "./escaped-layers.js";
import { zoomFilterMarkup } from "./page-zoom.js";
import { boundsMeet } from "./filter-bounds.js";
import type { FilterBounds } from "./filter-bounds.js";
import {
  aberrationFor,
  glassRecipe,
  glassSize,
  outlineFor,
  refractionFor,
  shadowFor,
} from "../core/materials.js";
import {
  backdropMarkup,
  fillMarkup,
  frostMarkup,
  glassShadowMarkup,
  lightMarkup,
  outlineMarkup,
  refractMarkup,
  hasBackdrop,
  overlayTintMarkup,
  tintChannels,
  tintMarkup,
  toneMarkup,
} from "./material-graph.js";
import type { MaterialOptions } from "../core/materials.js";
import {
  getMaterialMaps,
  getSurfaceMaterialMaps,
  peekMaterialMaps,
  peekSurfaceMaterialMaps,
} from "./maps.js";
import { getMaterialRenderer } from "./renderer.js";
import { capsuleMapGeometry, mapImage, mapUrl, surfaceMapResult } from "./map-image.js";
import type { MapPlane } from "./map-image.js";
import type { MaterialMaps } from "./maps.js";
import type { MapGeometry } from "../gpu/geometry.js";
import { createTicker } from "./ticker.js";
import {
  approachAngle,
  createSpecularLayer,
  lightAngle,
  ownsSpecular,
  restingAngle,
  subscribeLight,
} from "./specular.js";
import type { SpecularLayer } from "./specular.js";
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
  /** Motion level for this surface. System reduced motion always applies. */
  motion?: GlassMotion;
  /** A popup, such as a menu: its scene rises above sibling scenes while it is present. */
  popup?: boolean;
}
export interface GlassSceneController {
  /** Optional transparent, nested filter hosts in inner-to-outer order.
   * Gecko uses separate hosts for graphs exceeding its operation limit;
   * reserve the final host for progressive blur. */
  setContent(element: HTMLElement | null): void;
  addSurface(element: HTMLElement, options?: SurfaceOptions): () => void;
  /** Change how an added surface looks (material, appearance, tint, frost,
   * refraction, floating, aberration) without removing it: its shape, place
   * and motion carry on, so nothing anchored to it moves. */
  updateSurface(
    element: HTMLElement,
    options: Pick<
      SurfaceOptions,
      "material" | "appearance" | "tint" | "frost" | "refraction" | "floating" | "aberration"
    >,
  ): void;
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
  /** A popup whose contents wait, hidden, for its first glass. */
  pending?: {
    reveal: () => void;
    timer: ReturnType<typeof setTimeout>;
    drawn?: boolean;
    settled?: boolean;
  };
  element: HTMLElement;
  /** The options as the glass draws them: a tint is always hex here. */
  options: SurfaceOptions;
  /** A tint given as any other CSS color, resolved on the element each frame. */
  tintSource?: string;
  maps?: MaterialMaps;
  error?: Error;
  key?: string;
  /** The geometry measured most recently, which an in-flight request may predate. */
  wanted?: string;
  /** One map request in flight per lens; the newest result is shown meanwhile. */
  inflight?: boolean;
  animators: SurfaceAnimator[];
  /** The rim highlight that follows the light, and where it points now. */
  specular?: SpecularLayer;
  specularAngle: number;
  /** When the layout size last changed. */
  resized?: number;
  /** Where the surface's own glass layer is drawn, in Gecko. */
  frame?: LayerFrame;
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
  /** The surface's layout size, which its own backdrop filter is drawn in. */
  layoutWidth: number;
  layoutHeight: number;
  /** Inline backdrop filter and box shadow from before the surface was added. */
  backdropFilter: string;
  boxShadow: string;
  /** The backdrop glass as last written. */
  writtenGlass?: string;
  /** The scroll offset last written for a glass layer beneath a scrolling surface's children. */
  writtenScroll?: string;
  /** Whether the surface itself is fading (its own opacity below 1). */
  fading?: boolean;
  /** Whether the surface is on screen or near it. Chromium carries every
   * backdrop filter into every frame, so glass off screen has none. */
  visible: boolean;
}
let serial = 0;
let lensSerial = 0;
/**
 * Chromium draws each surface's glass as that surface's own backdrop filter
 * (see backdrop-glass.ts): glass costs only its own pixels, and nothing else
 * in the page refilters when it changes. A surface holding other glass draws
 * its glass on a layer beneath its children instead, since a backdrop filter
 * would hide the glass behind it from them. Other engines refract the scene's
 * content layer in one filter.
 */
const perSurface = chromium;
const mapKey = (g: MapGeometry) => JSON.stringify(capsuleMapGeometry(g) ?? g);
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
  const unregisterRoot = registerSceneRoot(root);
  const owner = ++serial;
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.style.position = "absolute";
  svg.style.inset = "0";
  svg.style.pointerEvents = "none";
  const defs = document.createElementNS(ns, "defs");
  // Specular filters change on their own, outside the retained scene filters.
  const specularDefs = document.createElementNS(ns, "defs");
  svg.append(defs, specularDefs);
  root.append(svg);
  const maxSurfaces = Math.max(1, Math.min(64, Math.floor(config.maxSurfaces ?? 16)));
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
  /** The light specular surfaces follow, while any is registered. */
  let lit: ReturnType<typeof subscribeLight> | undefined;
  let litCount = 0;
  let litAt = 0;
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
  // waits for painting to stop, which would hold the first new shape back.
  const warmRenderer =
    typeof navigator !== "undefined" && "gpu" in navigator
      ? setTimeout(() => {
          getMaterialRenderer()
            .then((renderer) => renderer.warmed)
            .catch(() => undefined);
        }, 600)
      : undefined;
  const warmStyle = setTimeout(() => warmDocumentStyle(root.ownerDocument), 700);
  let surfaceFilters = "";
  /** Whether the scene has a backdrop color (`--lg-backdrop`) to show where
   * its content is transparent. */
  let backdrop = false;
  let progressiveOutsets = 0;
  let composedZoom = `${pageZoom()} ${devicePixelRatio}`;
  /** Gecko draws each surface's glass in a layer of its own; only Gecko
   * downloads that code, and its glass waits for it. */
  let layers: LensLayers | undefined;
  if (gecko)
    import("./lens-layers.js").then(
      ({ createLensLayers }) => {
        if (disposed) return;
        layers = createLensLayers(root);
        adoptBlurHost();
        dirty = true;
        ticker.wake();
      },
      () => undefined,
    );
  /** WebKit composites some content apart from the content's filter, above
   * the glass it draws; such layers draw a copy of the glass on themselves.
   * Only WebKit needs this, so other engines never download its code. */
  let escapes: EscapedLayers | undefined;
  if (webkit)
    import("./escaped-layers.js").then(
      ({ createEscapedLayers }) => {
        if (disposed) return;
        escapes = createEscapedLayers(() => ticker.wake());
        ticker.wake();
      },
      () => undefined,
    );
  let layerGlass: LayerGlass[] = [];
  let layerKey = "";
  const layerStyles = new Map<HTMLElement, FilterStyle>();
  const layerIds = new WeakMap<HTMLElement, number>();
  let contentRect = { left: 0, top: 0, width: 0, height: 0 };
  let lastPaintOrder = "";
  /** One claim per filtered element; scenes sharing an element chain their filters. */
  interface FilterStyle {
    owner: string;
    releasePaint?: () => void;
  }
  const retainFilter = (element: HTMLElement, kind = ""): FilterStyle => ({
    owner: `${owner}${kind}`,
    releasePaint: webkit ? acquireFilterPaintRoot(element) : undefined,
  });
  const applyFilter = (element: HTMLElement, style: FilterStyle, filters: string) =>
    setFilterPart(element, style.owner, sceneDepth(root), filters);
  const releaseFilter = (element: HTMLElement, style: FilterStyle) => {
    releaseFilterPart(element, style.owner);
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
    if (blurHost) {
      releaseFilter(blurHost.element, blurHost.style);
      blurHost.element.removeAttribute("data-glass-blur-active");
    }
    blurHost = undefined;
    contentStyle = undefined;
  };
  /** Gecko's layers draw the content's blur on its wrapper, once they load. */
  const adoptBlurHost = () => {
    const host = content?.parentElement;
    if (!layers || blurHost || !host?.hasAttribute("data-glass-blur-host")) return;
    host.setAttribute("data-glass-blur-active", "");
    blurHost = { element: host, style: retainFilter(host, "blur") };
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
  /** Options with a tint the filter can read: hex tints as they are, any
   * other CSS color set apart to be resolved on the element. */
  const authoredTint = (options: SurfaceOptions) =>
    options.tint && !hexTint.test(options.tint)
      ? { options: { ...options, tint: undefined }, source: options.tint }
      : { options, source: undefined };
  /** The shorter side of a surface, which sets how its glass looks. */
  const sizeOf = (l: Lens) => glassSize(l.options, l.w, l.h);
  const refractionOf = (l: Lens, parents: Lens[]) => {
    if (l.options.refraction !== undefined) return l.options.refraction;
    if (!parents.length) return refractionFor(l.options.material ?? "regular", sizeOf(l)).amount;
    const inset = Math.min(
      ...parents.map((parent) =>
        Math.min(
          l.x - parent.x,
          l.y - parent.y,
          parent.x + parent.w - l.x - l.w,
          parent.y + parent.h - l.y - l.h,
        ),
      ),
    );
    return Math.max(0, Math.min(8, inset * 0.6));
  };
  const blurOf = (l: Lens, soften: number) => {
    const recipe = glassRecipe(l.options, sizeOf(l));
    return Math.max(recipe.blur, recipe.fill) * soften;
  };
  /** Paint order changes only with the DOM: it is sorted again after a
   * mutation or a registration, never on every frame. */
  let structure = 0,
    orderedAt = -1,
    ordered: Lens[] = [];
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
      foregroundOrder = [...order(), ...foregrounds].sort((a, b) =>
        comparePaintOrder(a.element, b.element),
      );
      foregroundOrderAt = structure;
    }
    return foregroundOrder;
  };
  /** The scene's glass over a filtered box of `width` × `height`, for these
   * surfaces in paint order and in that box's coordinates. `outer` counts the
   * outsets of filters chained after it, and `regions` the progressive blur. */
  function sceneGraph(
    ordered: Lens[],
    width: number,
    height: number,
    outer: number,
    regions: ReturnType<typeof progressive.regions>,
    onLayer = false,
  ) {
    const parentsOf = (l: Lens) =>
      ordered.filter((parent) => parent !== l && parent.element.contains(l.element));
    // The backdrop lies beneath the content. A layer composited apart from
    // the content draws its glass over the content's, which already has it.
    const backed = backdrop && !onLayer;
    // One filter draws every surface of the scene. The source is extended
    // once; each surface works only inside its own crop and contributes its
    // masked material, rim, and light to a single final merge. A surface's
    // sampled backdrop includes earlier surfaces only when it is near enough
    // to see them, so full-size intermediates are built only where needed.
    // A popup waiting for its first glass joins once its maps are decoded,
    // so its glass never draws empty for a frame.
    const drawn = ordered.filter(
      (l) => l.maps && l.opacity >= 0.001 && !(l.pending && !warmer.has(l.maps)),
    );
    const parents = new Map(drawn.map((l) => [l, parentsOf(l)] as const));
    const wanted = new Map(drawn.map((l) => [l, refractionOf(l, parents.get(l)!)] as const));
    // Glass shows other glass when it overlaps it or bends it in from its
    // rim; a frosted blur reaching further adds only a faint tint, not worth
    // a shared full-size pass on every frame.
    const reach = (l: Lens) => wanted.get(l)! + 4;
    const near = (a: Lens, b: Lens) => {
      const r = Math.max(reach(a), reach(b));
      return (
        a.x < b.x + b.w + r && b.x - r < a.x + a.w && a.y < b.y + b.h + r && b.y - r < a.y + a.h
      );
    };
    // WebKit adds up the outsets of every branch of a filter's graph, not
    // only along its deepest path, and sizes its buffer by the sum. Each
    // surface drawn as its own branch costs a full lens of outsets there, so
    // opaque surfaces of one material that neither touch nor neighbor
    // other glass share a branch: their maps and masks merge into one set of
    // images, which a single material pass refracts. Elsewhere a shared
    // branch only spreads its passes over the empty space between surfaces.
    const branchKey = (l: Lens) =>
      `${l.options.material ?? "regular"},${l.options.appearance ?? "light"},${l.options.frost ?? 0},${l.options.tint ?? ""},${l.options.floating ?? false},${Math.min(160, Math.round(sizeOf(l)))},${wanted.get(l)}`;
    const independent = (l: Lens) => webkit && l.opacity >= 0.999 && !parents.get(l)!.length;
    // Neighbors drawn in the same pass need no finished glass of each other.
    // A shared branch sees no glass beneath it, so only earlier surfaces can
    // keep a surface out; glass above reads its rim and light either way, and the
    // shared branch is drawn where its first member is.
    const drawnIndex = new Map(drawn.map((l, index) => [l, index] as const));
    const shareable = (l: Lens) =>
      independent(l) &&
      !drawn.some(
        (other) =>
          (other !== l &&
            near(l, other) &&
            (drawnIndex.get(other)! < drawnIndex.get(l)!
              ? !independent(other) || branchKey(other) !== branchKey(l)
              : false)) ||
          (other !== l && near(l, other) && mapBoxesOverlap(l, other)),
      );
    let units: Lens[][] = [];
    const sharedUnits = new Map<string, Lens[]>();
    for (const l of drawn) {
      if (!shareable(l)) {
        units.push([l]);
        continue;
      }
      const key = branchKey(l);
      let unit = sharedUnits.get(key);
      if (!unit) {
        unit = [];
        sharedUnits.set(key, unit);
        units.push(unit);
      }
      unit.push(l);
    }
    const materialGroupOf = new Map(units.flatMap((unit) => unit.map((l) => [l, unit] as const)));
    const scale = filterPixelRatio();
    const outsetsOf = new Map(
      drawn.map((l) => {
        const recipe = glassRecipe(l.options, sizeOf(l));
        const blur = blurOutsets(Math.max(recipe.blur, recipe.fill));
        return [l, scale * (blur + wanted.get(l)!)] as const;
      }),
    );
    // A branch samples the finished layers of the glass it touches, which
    // adds their outsets to its own.
    const outsetsFor = (groups: readonly Lens[][]) =>
      groups.reduce(
        (sum, unit) =>
          sum +
          Math.max(...unit.map((l) => outsetsOf.get(l)!)) +
          (unit.length === 1
            ? drawn
                .filter(
                  (other) =>
                    !unit.includes(other) && unit.some((member) => overlaps(other, member)),
                )
                .reduce((most, other) => Math.max(most, outsetsOf.get(other)!), 0)
            : 0),
        0,
      );
    const soften = filterBudgetFactor(width * scale, height * scale, outsetsFor(units));
    const amounts = new Map(drawn.map((l) => [l, wanted.get(l)! * soften] as const));
    const sampling = new Map(
      drawn.map((l) => {
        // Ordinary outlines refract inward; custom outlines retain full reach.
        const symmetric = Boolean(l.shown && !l.shown.outline);
        return [
          l,
          refractionSamplingBounds(
            { x: l.x - 2, y: l.y - 2, width: l.w + 4, height: l.h + 4 },
            amounts.get(l)!,
            symmetric,
          ),
        ] as const;
      }),
    );
    // Every surface samples its own padded crop; shared intermediates only
    // need to cover the crops of the surfaces that read them.
    const cropOf = (l: Lens) => {
      const padding = Math.ceil(3 * blurOf(l, soften) + amounts.get(l)! + 8);
      return {
        x: l.x - 2 - padding,
        y: l.y - 2 - padding,
        width: l.w + 4 + 2 * padding,
        height: l.h + 4 + 2 * padding,
      };
    };
    const cluster = (extra: number) =>
      units.flatMap((unit) => {
        if (unit.length < 2) return [unit];
        const saturated = glassRecipe(unit[0].options, sizeOf(unit[0])).saturation !== 1;
        const tinted = /^#[\da-f]{6}$/i.test(unit[0].options.tint ?? "");
        const split = clusterFilterBranches(
          unit,
          (l) => {
            const output = { x: l.x - 2, y: l.y - 2, width: l.w + 4, height: l.h + 4 };
            const reach = amounts.get(l)! + 3;
            return {
              output,
              crop: cropOf(l),
              sampled: {
                x: output.x - reach,
                y: output.y - reach,
                width: output.width + 2 * reach,
                height: output.height + 2 * reach,
              },
            };
          },
          // The frost is sampled; displacement, tone and the mask are not.
          { output: (saturated ? 5 : 4) + (tinted ? 3 : 0), sampled: 1 },
          1 + extra,
        );
        extra -= split.length - 1;
        return split;
      });
    // Splitting sparse groups must not soften the glass to fit more outsets,
    // or push a whole layer past WebKit's tiling size. Every branch adds its
    // outsets to the layer, and a tiled layer runs the whole filter per tile,
    // so take the most branches that still fit.
    const untiled = untiledOutsets(width, height) * scale;
    const fits = (groups: Lens[][]) =>
      !gecko && filterBudgetFactor(width * scale, height * scale, outsetsFor(groups)) >= soften;
    let clustered = cluster(Infinity);
    if (fits(clustered) && outsetsFor(units) > untiled) units = clustered;
    else
      for (let extra = clustered.length - units.length; extra > 0; clustered = cluster(--extra))
        if (fits(clustered) && outsetsFor(clustered) <= untiled) {
          units = clustered;
          break;
        }
    const unitName = (unit: readonly Lens[]) =>
      unit.length > 1
        ? `g${unit
            .map((member) => member.serial)
            .sort((a, b) => a - b)
            .join("-")}`
        : `s${unit[0].serial}`;
    const crops = drawn.map(cropOf);
    const unionOf = (boxes: readonly FilterBounds[]): FilterBounds => {
      const x = Math.min(...boxes.map((b) => b.x)),
        y = Math.min(...boxes.map((b) => b.y));
      return {
        x,
        y,
        width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
        height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
      };
    };
    const bounds = filterBounds(width, height, crops, 0);
    const region = (box: FilterBounds) =>
      `x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}"`;
    // Edge pixels are repeated only past the sides some surface samples
    // beyond; glass well inside its content reads the source directly.
    // WebKit repeats them only as far as displacement reads: tiling the blur
    // padding of full-height panels can exceed its software buffer, while
    // glass near an edge must refract the content's edge, not transparency.
    const buildStage = (stageUnits: readonly Lens[][]) => {
      const unitOf = new Map(stageUnits.flatMap((unit) => unit.map((l) => [l, unit] as const)));
      const reads = stageUnits.flat().map((l) => (webkit ? sampling.get(l)! : cropOf(l)));
      // A layer's own glass sees nothing past its pixels; transparency there is exact.
      const tiles =
        stageUnits.length && !onLayer
          ? edgeTiles(
              width,
              height,
              webkit ? unionSamplingBounds(reads) : bounds,
              "scene",
              crossedSides(width, height, reads),
            )
          : { markup: "", names: {} };
      const parts: string[] = [tiles.markup];
      const source = "SourceGraphic";
      const beneathOf = new Map(
        stageUnits.map((unit, index) => {
          const lens = unit[0];
          const beneath =
            unit.length > 1
              ? []
              : stageUnits
                  .slice(0, index)
                  .flat()
                  .filter(
                    (earlier) =>
                      materialGroupOf.get(earlier) !== materialGroupOf.get(lens) &&
                      unit.some((member) => overlaps(earlier, member, reach(lens))),
                  );
          return [unit, beneath] as const;
        }),
      );
      const shared = webkit
        ? sharedBackdropMaterials(
            stageUnits.map((unit) => ({
              key: unit,
              id: unitName(unit),
              options: unit[0].options,
              size: sizeOf(unit[0]),
              bounds: unionSamplingBounds(unit.map((member) => sampling.get(member)!)),
              inputs: beneathOf.get(unit)!,
            })),
            soften,
            backed,
          )
        : undefined;
      const emitted = new Set<string>();
      // Every input a surface reads is a realized image: the source, edge
      // tiles, map images, and the finished layers of glass it overlaps. A
      // finished layer read by a second consumer with different bounds is
      // evaluated again from its blurs up, so glass merely near another
      // surface takes only that surface's rim and light images instead.
      // Neighbors past the same edges, with no glass beneath, read the same
      // backdrop: the source and its edge tiles. One cropped merge over their
      // overlapping crops serves all of them, rather than one buffer each.
      // A surface never reads past an edge its own crop does not cross, so
      // tiles another member needs never reach it.
      const sharedCrops = new Map<Lens[], { name: string; markup: string; emitted: boolean }>();
      if (webkit) {
        const eligible = stageUnits.filter(
          (unit) =>
            !beneathOf.get(unit)!.length &&
            tilesFor(width, height, unionOf(unit.map(cropOf))).some((key) => tiles.names[key]),
        );
        const groups: { units: Lens[][]; box: FilterBounds }[] = [];
        for (const unit of eligible) {
          let group = { units: [unit], box: unionOf(unit.map(cropOf)) };
          for (let index = 0; index < groups.length;) {
            if (!boundsMeet(group.box, groups[index].box)) {
              index++;
              continue;
            }
            const joined = groups.splice(index, 1)[0];
            group = {
              units: [...joined.units, ...group.units],
              box: unionOf([joined.box, group.box]),
            };
            index = 0;
          }
          groups.push(group);
        }
        for (const group of groups) {
          if (group.units.length < 2) continue;
          const keys = new Set(
            group.units.flatMap((unit) => tilesFor(width, height, unionOf(unit.map(cropOf)))),
          );
          const edges = [...keys]
            .map((key) => tiles.names[key])
            .filter((name): name is string => Boolean(name));
          const name = `crop${group.units.map(unitName).sort().join("")}`;
          const below = backed ? [`${name}backdrop`] : [];
          const markup = `${backed ? backdropMarkup(`${name}backdrop`, group.box) : ""}<feMerge result="${name}" ${region(group.box)}>${[...below, ...edges].map((n) => `<feMergeNode in="${n}"/>`).join("")}<feMergeNode in="${source}"/></feMerge>`;
          const entry = { name, markup, emitted: false };
          for (const unit of group.units) sharedCrops.set(unit, entry);
        }
      }
      const layersOf = new Map<Lens[], string[]>();
      const maskOf = new Map<Lens[], string>();
      stageUnits.forEach((unit) => {
        // The first surface of a shared branch stands for all: they share
        // material, appearance, tint, and refraction.
        const l = unit[0];
        const o = l.options,
          // Names follow the surface, not its position, so primitives persist
          // as other surfaces enter and leave the scene. A shared identity
          // comes directly from its unique members, without retaining old groups.
          p = unitName(unit);
        const box = unionOf(
          unit.map((member) => ({
            x: member.x - 2,
            y: member.y - 2,
            width: member.w + 4,
            height: member.h + 4,
          })),
        );
        const x = box.x,
          y = box.y,
          w = box.width,
          h = box.height;
        /** A surface draws its map in its box. A shared branch merges the
         * images of its surfaces into one. */
        const image = (plane: MapPlane, result: string) => {
          const memberImage = (member: Lens, name: string) =>
            mapImage(
              member.maps!,
              plane,
              name,
              member.x - 2,
              member.y - 2,
              member.w + 4,
              member.h + 4,
            );
          if (unit.length === 1) return memberImage(l, result);
          // Keep each image's singleton identity when group membership
          // changes. Reloading unchanged maps here can stall and flash the
          // entire content filter.
          return (
            unit
              .map((member) => memberImage(member, surfaceMapResult(member.serial, plane)))
              .join("") +
            `<feMerge result="${result}" ${region(box)}>${unit.map((member) => `<feMergeNode in="${surfaceMapResult(member.serial, plane)}"/>`).join("")}</feMerge>`
          );
        };
        const opaque = unit.length > 1 || l.opacity >= 0.999;
        const first = parts.length;
        // The field displaces with its red and green channels and covers
        // the shape with its alpha, which a fading surface scales.
        parts.push(
          image("field", `${p}field`),
          ...(opaque
            ? []
            : [
                `<feComponentTransfer in="${p}field" result="${p}mask"><feFuncA type="linear" slope="${l.opacity}"/></feComponentTransfer>`,
              ]),
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
          const touching = unit.some((member) => overlaps(earlier, member));
          if (touching) inputs.push(...layersOf.get(unitOf.get(earlier)!)!);
          else {
            const q = `s${earlier.serial}`;
            for (const plane of ["rim", "light"] as const) {
              parts.push(
                mapImage(
                  earlier.maps!,
                  plane,
                  `${p}by${q}${plane}`,
                  earlier.x - 2,
                  earlier.y - 2,
                  earlier.w + 4,
                  earlier.h + 4,
                ),
              );
              inputs.push(`${p}by${q}${plane}`);
            }
          }
        }
        const edges = tilesFor(width, height, crop)
          .map((key) => tiles.names[key])
          .filter((name): name is string => Boolean(name));
        // Glass in WebKit can share its frost with neighbors frosted alike.
        const material = shared?.get(unit);
        // Glass well inside its content reads the source directly. Only a
        // surface past the content's edge, above other glass, or over a
        // backdrop color gathers what is behind it into a cropped merge,
        // which software filters pay for. The backdrop color lies beneath
        // the rest, limited to the crop: it shows only through the glass.
        const gathered = edges.length || inputs.length || (backed && !material);
        const sharedCrop = sharedCrops.get(unit);
        if (sharedCrop) {
          if (!sharedCrop.emitted) {
            parts.push(sharedCrop.markup);
            sharedCrop.emitted = true;
          }
        } else if (gathered) {
          const below = backed ? [`${p}backdrop`] : [];
          parts.push(
            `${backed ? backdropMarkup(`${p}backdrop`, crop) : ""}<feMerge result="${p}crop" ${region(crop)}>${[...below, ...edges].map((n) => `<feMergeNode in="${n}"/>`).join("")}<feMergeNode in="${source}"/>${inputs.map((n) => `<feMergeNode in="${n}"/>`).join("")}</feMerge>`,
          );
        }
        const cropped = sharedCrop?.name ?? (gathered ? `${p}crop` : source);
        let base = cropped;
        if (material) {
          if (!emitted.has(material.result)) {
            parts.push(material.markup);
            emitted.add(material.result);
          }
          base = material.result;
        } else {
          const frost = frostMarkup(p, cropped, o, sizeOf(l), soften);
          parts.push(frost.markup);
          base = frost.result;
        }
        const amount = amounts.get(l)!;
        // Blur needs the sampling neighborhood, while pointwise tone and
        // chroma only need the pixels that refraction delivers to the lens.
        parts.push(refractMarkup(p, base, amount, aberrationFor(o, sizeOf(l)) * soften));
        const filled = fillMarkup(
          p,
          `${p}refracted`,
          cropped,
          o,
          sizeOf(l),
          soften,
          base === cropped ? undefined : base,
        );
        parts.push(filled.markup, toneMarkup(p, o, sizeOf(l), filled.result));
        let color = `${p}color`;
        let light = `${p}light`;
        const tint = tintChannels(o);
        if (tint) {
          const tinted = tintMarkup(p, o, tint);
          parts.push(tinted.markup);
          color = tinted.color;
          light = `${p}tintLight`;
        }
        // The rim's light adds to the face; its outline darkens what is
        // behind the glass just outside it, faded with the surface.
        parts.push(
          image("light", `${p}light`),
          ...(tint ? [overlayTintMarkup(`${p}light`, light, tint)] : []),
          lightMarkup(p, color, light, mask, o.material),
          image("rim", `${p}rim`),
          // The frosted copy already holds what is behind the rim; reading it
          // spares another pass over the whole content.
          outlineMarkup(p, base, `${p}rim`, l.opacity, outlineFor(o, sizeOf(l))),
          // Inside the shape, the rim map is a faint shade over the face.
          `<feComposite in="${p}rim" in2="${mask}" operator="in" result="${p}ring"/>`,
        );
        // Over a layer composited apart from the content, the content's own
        // glass lies beneath. Refraction only moves pixels, so the glass
        // of both together is this layer's glass over the content's,
        // weighted by how much of the layer the refraction carried here.
        if (onLayer)
          parts.push(
            `<feColorMatrix in="${p}refracted" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="${p}cover"/>`,
            `<feComposite in="${p}litInside" in2="${p}cover" operator="in" result="${p}ownInside"/>`,
            `<feComposite in="${p}outline" in2="${p}cover" operator="in" result="${p}ownOutline"/>`,
          );
        // Without a subregion every primitive covers the whole filter region,
        // the scene plus padding. Only the surface's box matters, plus the
        // reach of its displacement for the material it samples.
        const reachBox = unionSamplingBounds(unit.map((member) => sampling.get(member)!));
        // WebKit's displacement reads its input only inside its own
        // subregion and writes transparent pixels for any sample beyond it,
        // so it must cover every pixel it reaches; the mask clips it after.
        const sampledStages = new Set(
          [
            ...["frost", "fill", "blend", "mix"],
            ...(webkit ? ["refracted", "refractedR", "refractedB"] : []),
          ].map((name) => `${p}${name}`),
        );
        for (let index = first; index < parts.length; index++)
          parts[index] = parts[index].replace(
            /<(feFlood|feComposite|feDisplacementMap|feColorMatrix|feComponentTransfer|feGaussianBlur|feBlend)\b([^>]*?)(\/?)>/g,
            (tag, name: string, attributes: string, close: string) => {
              if (/\sx="/.test(attributes)) return tag;
              const region = sampledStages.has(/result="([^"]+)"/.exec(attributes)?.[1] ?? "")
                ? reachBox
                : { x, y, width: w, height: h };
              return `<${name}${attributes} x="${region.x}" y="${region.y}" width="${region.width}" height="${region.height}"${close}>`;
            },
          );
        // Regular glass casts a soft shadow around itself, as on macOS: its
        // coverage blurred, nudged down, kept outside the shape, faint.
        const cast = !onLayer && !nested.length ? shadowFor(o, sizeOf(l)) : undefined;
        const shadow = cast ? glassShadowMarkup(p, mask, box, l.opacity, cast) : undefined;
        if (shadow) parts.push(shadow.markup);
        const layer = onLayer
          ? [`${p}ownOutline`, `${p}ownInside`, `${p}ring`]
          : [`${p}outline`, ...(shadow ? [shadow.result] : []), `${p}litInside`, `${p}ring`];
        layersOf.set(unit, layer);
        // The content is cut away only where the glass covers it fully. At a
        // partly covered edge pixel the glass draws over the content instead:
        // cutting there too would leave the two partial coverages short of
        // whole, and the page behind would show through the rim.
        parts.push(
          `<feComponentTransfer in="${mask}" x="${x}" y="${y}" width="${w}" height="${h}" result="${p}cut"><feFuncA type="discrete" tableValues="${"0 ".repeat(63)}1"/></feComponentTransfer>`,
        );
        maskOf.set(unit, `${p}cut`);
      });
      // Replace covered input, rather than painting a sparse refracted copy
      // over its sharp original. Remove covered source pixels even when the
      // DOM backdrop is transparent. Sparse contributions preserve alpha and
      // paint order with one full-scene pass, however many surfaces there are.
      if (stageUnits.length) {
        parts.push(
          composeSparseLayers(
            stageUnits.map((unit) => {
              const boxes = unit.map((l) => ({
                x: l.x - 2,
                y: l.y - 2,
                width: l.w + 4,
                height: l.h + 4,
              }));
              return {
                id: unitName(unit),
                mask: maskOf.get(unit)!,
                layers: layersOf.get(unit)!,
                bounds: unionSamplingBounds(boxes),
                ...(boxes.length > 1 ? { parts: boxes } : {}),
              };
            }),
          ),
        );
      }
      return parts.join("");
    };
    const primitives = () => {
      let primitives = buildStage(units);
      if (webkit) {
        const own = filterGraphOutsets(primitives);
        const total = own + outer;
        const budget = filterBudgetFactor(width * scale, height * scale, total * scale);
        const factor = own ? Math.max(0, Math.min(1, (total * budget - outer) / own)) : 1;
        if (factor < 1)
          primitives = primitives.replace(
            /(<fe(?:GaussianBlur|DisplacementMap)\b[^>]*?\s(?:stdDeviation|scale)=")([^"]+)(")/g,
            (_, before: string, value: string, after: string) =>
              before +
              value
                .split(" ")
                .map((part) => Number(part) * factor)
                .join(" ") +
              after,
          );
        // Chained filters add their outsets, so the progressive blur's count
        // toward the reach a repaint needs.
        const needed = repaintReach(primitives, width, height, regions);
        // Padding must not split a layer that would otherwise stay whole; one
        // that is split anyway needs the full reach in every tile.
        // Leave room for rounding and for layer bounds wider than the content.
        const tiled = own * factor + outer > untiledOutsets(width, height);
        const pad =
          Math.min(
            tiled ? tiledReach * needed : needed,
            outsetBudget(width * scale, height * scale) / scale,
            tiled ? Infinity : untiledOutsets(width, height, 0.85),
          ) - outer;
        if (pad > own * factor)
          primitives = padRepaintReach(primitives, Math.floor(pad), width, height);
      }
      return primitives;
    };
    return { drawn, parents, wanted, reach, bounds, primitives };
  }
  /** Rebuild the filters for the measured content size. The filter's
   * bounding box is the content layer, which can be taller than the scene
   * when it uses flow layout inside a scroller. */
  function compose(width: number, height: number) {
    if (perSurface) return composeBackdrops();
    if (!content || (gecko && !layers)) return;
    if (!width || !height) {
      if (contentStyle) applyFilter(content, contentStyle, "");
      return;
    }
    // Resizing the host svg invalidates every filter it defines.
    if (
      svg.getAttribute("width") !== String(width) ||
      svg.getAttribute("height") !== String(height)
    ) {
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
    const graph = sceneGraph(ordered, width, height, progressiveOutsets, progressive.regions());
    const { drawn, parents, wanted, reach, bounds } = graph;
    filterError = undefined;
    if (layers) {
      // Every surface draws its own glass; the content keeps only passes
      // Gecko renders on the GPU.
      const layered = new Map(
        drawn
          .filter((l) => l.frame)
          .map(
            (l) =>
              [
                l,
                {
                  serial: l.serial,
                  element: l.element,
                  options: l.options,
                  // Every surface sits beside the content and paints a copy of it.
                  mode: "copy",
                  maps: l.maps!,
                  x: l.x,
                  y: l.y,
                  w: l.w,
                  h: l.h,
                  opacity: l.opacity,
                  refraction: wanted.get(l)!,
                  frame: l.frame!,
                  parents: [] as LayerLens[],
                  beneath: [] as LayerLens[],
                } satisfies LayerLens,
              ] as const,
          ),
      );
      for (const [l, layer] of layered) {
        layer.parents.push(
          ...parents
            .get(l)!
            .map((parent) => layered.get(parent))
            .filter((parent) => parent !== undefined),
        );
        for (const earlier of drawn) {
          if (earlier === l) break;
          const below = layered.get(earlier);
          if (
            below &&
            !layer.parents.includes(below) &&
            !l.element.contains(earlier.element) &&
            overlaps(earlier, l, reach(l))
          )
            layer.beneath.push(below);
        }
      }
      layers.update(
        [...layered.values()],
        content,
        contentRect,
        blurHost?.matches ? { left: 0, top: 0, regions: progressive.regions() } : undefined,
        backdrop,
      );
    } else if (drawn.length) {
      const primitives = graph.primitives();
      const filterId = `${id}-scene`;
      filters.push(
        `<filter id="${filterId}" x="${bounds.x / width}" y="${bounds.y / height}" width="${bounds.width / width}" height="${bounds.height / height}" filterUnits="objectBoundingBox" primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB">${primitives}</filter>`,
      );
      applied.push(filterId);
    }
    // A layer WebKit composites apart from the content draws the glass over
    // it from its own pixels, in its own coordinates, and only where it paints.
    const layerTargets = new Map<HTMLElement, string>();
    if (!layers)
      for (const layer of layerGlass) {
        const over = ordered.filter(
          (l) =>
            !layer.element.contains(l.element) &&
            !l.element.contains(layer.element) &&
            // WebKit fails a filter whose primitives lie wholly outside the layer.
            intersects(layer, l, 2),
        );
        if (!over.length) continue;
        const local = over.map((l): Lens => ({ ...l, x: l.x - layer.x, y: l.y - layer.y }));
        const glass = sceneGraph(local, layer.w, layer.h, 0, [], true);
        if (!glass.drawn.length) continue;
        const markup = zoomFilterMarkup(glass.primitives(), 1 / layer.scale);
        const filterId = `${id}-k${layerIdOf(layer.element)}`;
        const b = glass.bounds;
        filters.push(
          `<filter id="${filterId}" x="${b.x / layer.w}" y="${b.y / layer.h}" width="${b.width / layer.w}" height="${b.height / layer.h}" filterUnits="objectBoundingBox" primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB">${markup}</filter>`,
        );
        layerTargets.set(layer.element, filterId);
      }
    const foregroundTargets = new Map<HTMLElement, string>();
    const filteredAncestors = new Map<ForegroundLens, Lens[]>();
    const targets = orderForeground();
    const rank = new Map(targets.map((target, index) => [target, index]));
    // Gecko's layers already refract the glass beneath them.
    if (!layers)
      targets.forEach((target) => {
        // An invisible foreground has no content to refract.
        if (!target.w || !target.h || target.opacity < 0.001) return;
        const overlays = ordered.filter(
          (lens) =>
            rank.get(target)! < rank.get(lens)! &&
            lens.maps &&
            lens.opacity > 0.001 &&
            overlaps(target, lens) &&
            !target.element.contains(lens.element) &&
            !lens.element.contains(target.element) &&
            ![...filteredAncestors].some(
              ([ancestor, applied]) =>
                ancestor.element.contains(target.element) && applied.includes(lens),
            ),
        );
        if (!overlays.length) return;
        const filterId = `${id}-f${target.serial}`;
        filters.push(foregroundFilter(filterId, target, overlays));
        foregroundTargets.set(target.element, filterId);
        filteredAncestors.set(target, overlays);
      });
    for (const element of foregroundStyles.keys())
      if (!foregroundTargets.has(element)) restoreForeground(element);
    const liveId = patchFilters(defs, filters, mapUrl);
    for (const [element, style] of layerStyles)
      if (!layerTargets.has(element)) {
        releaseFilter(element, style);
        layerStyles.delete(element);
      }
    for (const [element, filterId] of layerTargets) {
      let style = layerStyles.get(element);
      if (!style) {
        style = retainFilter(element, `layer${layerIdOf(element)}`);
        layerStyles.set(element, style);
      }
      applyFilter(element, style, `url("#${liveId(filterId)}")`);
    }
    for (const [element, filterId] of foregroundTargets) {
      if (!foregroundStyles.has(element))
        foregroundStyles.set(element, retainFilter(element, "foreground"));
      applyFilter(element, foregroundStyles.get(element)!, `url("#${liveId(filterId)}")`);
    }
    // A chain keeps every pass in the same CSS reference box. Nested filtered
    // elements change WebKit's reference bounds as preceding lenses overflow.
    surfaceFilters = applied.map((id) => `url("#${liveId(id)}")`).join(" ");
    notify();
  }
  /** Each surface's glass as its own backdrop filter, in Chromium. The
   * content keeps only its progressive blur. */
  function composeBackdrops() {
    const ordered = order();
    // A popup waiting for its first glass joins once its maps are decoded,
    // so its glass never draws empty for a frame.
    const drawn = ordered.filter(
      (l) =>
        l.maps &&
        l.visible &&
        l.layoutWidth > 0 &&
        l.layoutHeight > 0 &&
        !(l.pending && !warmer.has(l.maps)),
    );
    const filters: string[] = [];
    const planned = new Map<Lens, { filter: string; shadow: string; host: boolean }>();
    const pixel = 1 / (devicePixelRatio || 1);
    for (const l of drawn) {
      const parents = ordered.filter(
        (parent) => parent !== l && parent.element.contains(l.element),
      );
      const filter = `lg-${owner}-b${l.serial}`;
      filters.push(
        backdropGlassFilter({
          id: filter,
          maps: l.maps!,
          options: l.options,
          width: l.layoutWidth,
          height: l.layoutHeight,
          size: sizeOf(l),
          refraction: refractionOf(l, parents),
          backed: backdrop,
          pixel,
        }),
      );
      planned.set(l, {
        filter,
        shadow: backdropGlassShadow(l.options, sizeOf(l), parents.length > 0),
        // A surface holding other glass draws its glass on a layer among its children, which
        // the surface's own fade would cut off from what is behind it: while it fades it draws
        // its glass itself, as a surface without glass inside does.
        host:
          !l.fading && ordered.some((child) => child !== l && l.element.contains(child.element)),
      });
    }
    filterError = undefined;
    const liveId = patchFilters(defs, filters, mapUrl);
    for (const l of lenses) {
      const plan = planned.get(l);
      writeBackdrop(
        l,
        plan ? `url("#${liveId(plan.filter)}")` : "",
        plan?.shadow ?? "",
        plan?.host ?? false,
      );
    }
    surfaceFilters = "";
    notify();
  }
  /** Show a surface's backdrop glass: on the surface itself, or, for a
   * surface holding other glass, on the layer beneath its children. */
  function writeBackdrop(l: Lens, filter: string, shadow: string, host: boolean) {
    const key = `${filter}|${shadow}|${host}`;
    if (l.writtenGlass === key) return;
    l.writtenGlass = key;
    const style = l.element.style;
    if (host && filter) {
      style.backdropFilter = l.backdropFilter;
      style.setProperty("--lg-glass-filter", filter);
      if (!l.element.hasAttribute("data-glass-host")) l.element.setAttribute("data-glass-host", "");
    } else {
      style.removeProperty("--lg-glass-filter");
      l.element.removeAttribute("data-glass-host");
      style.backdropFilter = filter || l.backdropFilter;
    }
    style.boxShadow = shadow || l.boxShadow;
  }
  /** Put a surface's inline styles back as they were before it was added. */
  function restoreSurface(l: Lens) {
    const style = l.element.style;
    style.clipPath = l.clip;
    style.borderRadius = l.borderRadius;
    style.removeProperty("--lg-radius");
    style.removeProperty("--lg-scroll");
    l.writtenScroll = undefined;
    if (l.tintSource !== undefined) style.removeProperty("--lg-tint");
    if (l.writtenGlass !== undefined) {
      style.backdropFilter = l.backdropFilter;
      style.boxShadow = l.boxShadow;
      style.removeProperty("--lg-glass-filter");
      l.element.removeAttribute("data-glass-host");
      l.writtenGlass = undefined;
    }
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
        if (webkit && !l.maps && l.wanted !== key) {
          l.key = undefined;
          ticker.wake();
          return;
        }
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
        if (l.maps && !warm) setTimeout(apply, warmup);
        else apply();
      })
      .catch((e) => {
        l.inflight = false;
        if (!disposed && lenses.has(l) && l.key === key) {
          l.error = e instanceof Error ? e : new Error(String(e));
          notify(l.error);
        }
      })
      .finally(() => {
        pending--;
        ticker.wake();
      });
  }
  const intersects = (a: LayerBox, b: LayerBox, margin = 0) =>
    a.x - margin < b.x + b.w &&
    b.x - margin < a.x + a.w &&
    a.y - margin < b.y + b.h &&
    b.y - margin < a.y + a.h;
  const layerIdOf = (element: HTMLElement) => {
    let id = layerIds.get(element);
    if (id === undefined) {
      id = ++lensSerial;
      layerIds.set(element, id);
    }
    return id;
  };
  /** One frame of the scene: advance animations, sample geometry, and plan
   * the writes that follow. Reads happen here; every style write and the
   * filter rebuild run in the shared write phase, after all tickers measured. */
  function tick(now: number) {
    if (disposed) return false;
    const writes: (() => void)[] = [];
    let busy = updateControlMotion(root, now);
    let lensMoved = false;
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
    animators.forEach((animator) => {
      if (animator.frame(now)) busy = true;
    });
    lenses.forEach((l) =>
      l.animators.forEach((animator) => {
        if (animator.frame(now)) busy = true;
      }),
    );
    // Backdrop glass draws its own shape and casts its shadow past it, which
    // a clip would cut: the surface takes rounded corners that hold the shape.
    const setClip = (l: Lens, clip: string, radius = "0px") => {
      const key = `${clip}|${radius}`;
      if (l.writtenClip === key) return;
      l.writtenClip = key;
      writes.push(() => {
        l.element.style.clipPath = clip;
        l.element.style.borderRadius = radius;
      });
    };
    const setRadius = (l: Lens, radius: string) => {
      if (l.writtenRadius === radius) return;
      l.writtenRadius = radius;
      writes.push(() => l.element.style.setProperty("--lg-radius", radius));
    };
    lenses.forEach((l) => {
      if (layers) {
        // The surface's screen box and the scale its transforms apply, so its
        // glass layer can draw the content under it in its own space.
        const box = l.element.getBoundingClientRect();
        // Positions are relative to the content, so page scrolling changes nothing.
        const frame = {
          left: box.left - r.left,
          top: box.top - r.top,
          sx: box.width / (l.element.offsetWidth || box.width || 1),
          sy: box.height / (l.element.offsetHeight || box.height || 1),
          clientLeft: l.element.clientLeft,
          clientTop: l.element.clientTop,
        };
        if (
          !l.frame ||
          Object.entries(frame).some(
            ([key, value]) => Math.abs(value - l.frame![key as keyof LayerFrame]) > 0.01,
          )
        )
          dirty = true;
        l.frame = frame;
      }
      const rect = l.element.getBoundingClientRect();
      const x = rect.left - r.left,
        y = rect.top - r.top,
        w = rect.width,
        h = rect.height;
      if ([x - l.x, y - l.y, w - l.w, h - l.h].some((n) => Math.abs(n) > 0.05)) {
        Object.assign(l, { x, y, w, h });
        lensMoved = true;
        dirty = true;
      }
      if (perSurface && l.writtenGlass !== undefined) {
        const fading = Number(getComputedStyle(l.element).opacity) < 0.999;
        if (fading !== Boolean(l.fading)) {
          l.fading = fading;
          dirty = true;
        }
      }
      // A surface holding other glass draws its glass on a layer among its children; if the
      // surface scrolls, the layer is held in view, as the surface's own glass would be.
      if (perSurface && l.element.hasAttribute("data-glass-host")) {
        const scroll = `${l.element.scrollLeft}px ${l.element.scrollTop}px`;
        if (scroll !== l.writtenScroll) {
          l.writtenScroll = scroll;
          writes.push(() =>
            scroll === "0px 0px"
              ? l.element.style.removeProperty("--lg-scroll")
              : l.element.style.setProperty("--lg-scroll", scroll),
          );
        }
      }
      if (l.tintSource !== undefined) {
        const tint = resolveTint(l.element, l.tintSource);
        if (tint !== l.options.tint) {
          l.options = { ...l.options, tint };
          dirty = true;
        }
      }
      // A backdrop filter fades with its surface on its own.
      const opacity = perSurface ? 1 : effectiveOpacity(l.element, root);
      if (Math.abs(opacity - l.opacity) > 0.001) {
        l.opacity = opacity;
        dirty = true;
      }
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const { width, height } = getLayoutSize(l.element);
      if (width !== l.layoutWidth || height !== l.layoutHeight) {
        l.layoutWidth = width;
        l.layoutHeight = height;
        dirty = true;
      }
      if (!width || !height) return;
      const radius = l.options.radius ?? 8;
      const outline = l.resolveShape?.();
      if (l.resolveShape && (!outline || outline.length < 3)) {
        if (l.maps) {
          l.maps = undefined;
          dirty = true;
        }
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
        material: l.options.material ?? "regular",
      };
      // A capsule stretched unevenly keeps round ends in its content clip too.
      if (
        !perSurface &&
        radius === "capsule" &&
        !outline &&
        Math.abs(w / width - h / height) > 0.004
      ) {
        const points = shapePolygon(w, h, "capsule").map(([px, py]): ShapePoint => [
          (px * width) / w,
          (py * height) / h,
        ]);
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
        const corner = `${typeof radius === "number" ? Math.min(radius, width / 2, height / 2) : Math.min(width, height) / 2}px`;
        if (!perSurface)
          setClip(l, outline ? polygonClip(outline) : shapeClip(width, height, radius));
        else setClip(l, "none", outline ? "0px" : radius === "capsule" ? "9999px" : corner);
        setRadius(l, corner);
      }
      // A capsule whose size is changing reuses one sliced map at every width;
      // at rest it uses an exact map, which draws with a quarter of the images.
      const resizing = radius === "capsule" && now - (l.resized ?? 0) < 500;
      if (resizing) busy = true;
      request(l, g, resizing);
    });
    if (lit) {
      const dt = litAt ? Math.min(0.1, Math.max(0, (now - litAt) / 1000)) : 1 / 60;
      litAt = now;
      lenses.forEach((l) => {
        const layer = l.specular;
        if (!layer) return;
        const target =
          resolveMotion(l.options.motion) === "full"
            ? lightAngle(lit!.light, r.left + l.x + l.w / 2, r.top + l.y + l.h / 2)
            : restingAngle;
        const previous = l.specularAngle;
        l.specularAngle = approachAngle(previous, target, dt);
        if (l.specularAngle !== previous) busy = true;
        const angle = l.specularAngle,
          maps = l.maps,
          shown = l.shown,
          strength = l.options.appearance === "dark" ? 0.8 : 1;
        writes.push(() => {
          layer.place(maps, shown?.width ?? 0, shown?.height ?? 0);
          layer.aim(angle, strength);
        });
      });
    }
    foregrounds.forEach((target) => {
      const box = target.element.getBoundingClientRect();
      const next = { x: box.left - r.left, y: box.top - r.top, w: box.width, h: box.height };
      if (
        Object.entries(next).some(
          ([key, value]) => Math.abs(value - target[key as "x" | "y" | "w" | "h"]) > 0.05,
        )
      ) {
        Object.assign(target, next);
        dirty = true;
      }
    });
    if (escapes) {
      const drawn = content
        ? [...lenses].filter((l) => l.maps && l.opacity > 0.001 && l.w > 0 && l.h > 0)
        : [];
      const plan = escapes.plan(
        content,
        r,
        drawn,
        [...lenses].map((l) => l.element),
        now,
        structure,
        (l) => blurOf(l as Lens, 1),
      );
      const key = plan.layers
        .map(
          (layer) =>
            `${layerIdOf(layer.element)}:${[layer.x, layer.y, layer.w, layer.h, layer.scale].map((n) => n.toFixed(2)).join(",")}`,
        )
        .join(";");
      if (key !== layerKey) {
        layerKey = key;
        layerGlass = plan.layers;
        dirty = true;
      }
      if (plan.busy) busy = true;
      writes.push(plan.write);
    }
    // CSS stacking can change without geometry changing, but only with the DOM.
    const paintOrder = orderForeground()
      .map((target) => target.serial)
      .join(",");
    if (paintOrder !== lastPaintOrder) {
      dirty = true;
      lastPaintOrder = paintOrder;
    }
    // The wrapper draws the content's blur only where it has the content's box.
    if (blurHost) {
      const box = blurHost.element.getBoundingClientRect();
      blurHost.matches =
        Math.abs(box.left - r.left) < 0.5 &&
        Math.abs(box.top - r.top) < 0.5 &&
        Math.abs(box.width - r.width) < 0.5 &&
        Math.abs(box.height - r.height) < 0.5;
    }
    const blur = content ? progressive.update(content) : "";
    // Layers apply the same regions themselves.
    if (blurHost) {
      const key = JSON.stringify([blurHost.matches, progressive.regions()]);
      if (key !== blurKey) {
        blurKey = key;
        dirty = true;
      }
    }
    const nextOutsets = progressive.outsets();
    if (nextOutsets !== progressiveOutsets) {
      progressiveOutsets = nextOutsets;
      dirty = true;
    }
    // The backdrop color resolves where the glass draws; only whether there
    // is one changes the filters.
    const backed = hasBackdrop(getComputedStyle(root).getPropertyValue("--lg-backdrop"));
    if (backed !== backdrop) {
      backdrop = backed;
      dirty = true;
    }
    // Filters are written in the zoom they were composed for.
    const zoom = `${pageZoom()} ${devicePixelRatio}`;
    if (zoom !== composedZoom) {
      composedZoom = zoom;
      dirty = true;
    }
    const waiting = [...lenses].filter((l) => l.pending);
    if (waiting.length) {
      busy = true;
      // Its maps finishing their decode changes what is drawn.
      if (waiting.some((l) => l.maps && warmer.has(l.maps) && !l.pending!.drawn)) dirty = true;
    }
    const changed = dirty;
    const moving = (busy || lensMoved) && now - composedAt < 15;
    const rebuild = dirty && !moving;
    if (rebuild) composedAt = now;
    if (!moving) dirty = false;

    const nextProgressiveError = progressive.error();
    const progressiveErrorChanged =
      progressiveFilterError?.message !== nextProgressiveError?.message;
    progressiveFilterError = nextProgressiveError;
    // A popup shows its contents in the frame its glass first draws.
    // ...one frame after it is first drawn, once its layout has settled under
    // the shape the scene gave it (concentric rows resize on that first frame).
    const revealed = rebuild || !changed ? waiting.filter((l) => l.pending!.settled) : [];
    for (const l of waiting)
      if (l.maps && warmer.has(l.maps) && l.w > 0) {
        if (l.pending!.drawn) l.pending!.settled = true;
        l.pending!.drawn = true;
      }
    writes.push(() => {
      if (rebuild) compose(contentWidth, contentHeight);
      for (const l of revealed) l.pending?.reveal();
      if (content) {
        const filters = blurHost?.matches
          ? surfaceFilters
          : (progressive.scrollsContent() ? [blur, surfaceFilters] : [surfaceFilters, blur])
              .filter(Boolean)
              .join(" ");
        if (contentStyle) applyFilter(content, contentStyle, filters);
        if (blurHost) applyFilter(blurHost.element, blurHost.style, blurHost.matches ? blur : "");
      }
      if (progressiveErrorChanged) notify();
    });
    return {
      active: busy || changed || pending > 0,
      write: () => {
        for (const write of writes) write();
      },
    };
  }
  const releaseSpecular = (lens: Lens) => {
    if (!lens.specular) return;
    lens.specular.dispose();
    lens.specular = undefined;
    if (--litCount === 0) {
      lit?.release();
      lit = undefined;
      litAt = 0;
    }
  };
  /** Which surfaces are on screen, for Chromium's backdrop glass. */
  const visibility =
    perSurface && typeof IntersectionObserver === "function"
      ? new IntersectionObserver(
          (entries) => {
            for (const entry of entries)
              for (const l of lenses)
                if (l.element === entry.target && l.visible !== entry.isIntersecting) {
                  l.visible = entry.isIntersecting;
                  dirty = true;
                }
            ticker.wake();
          },
          { rootMargin: "50%" },
        )
      : undefined;
  const ticker = createTicker(tick, {
    root,
    // The filters and the warmer are this scene's own output.
    ignore: (target, record) =>
      svg.contains(target) ||
      ownsSpecular(target) ||
      warmer.owns(target) ||
      Boolean(layers?.owns(target)) ||
      Boolean(escapes?.owns(target, record)) ||
      (record.type === "attributes" &&
        record.attributeName === "style" &&
        layerStyles.has(target as HTMLElement)),
    onMutation: () => {
      structure++;
    },
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
      adoptBlurHost();
      if (element) ticker.observe(element);
      dirty = true;
      ticker.wake();
    },
    addSurface(element, options = {}) {
      if (lenses.size >= maxSurfaces)
        throw new RangeError(
          `GlassScene supports ${maxSurfaces} surfaces; increase maxSurfaces up to 64 or split the scene.`,
        );
      if (!Number.isFinite(options.refraction ?? 60) || (options.refraction ?? 60) < 0)
        throw new RangeError("Refraction must be finite and nonnegative.");
      cornerOptions(options.radius ?? 8);
      const lens: Lens = {
        serial: ++lensSerial,
        element,
        options: authoredTint(options).options,
        tintSource: authoredTint(options).source,
        resolveShape: options.concentric
          ? createConcentricResolver(
              element,
              typeof options.concentric === "object" ? options.concentric.inset : undefined,
              options.radius ?? 8,
            )
          : undefined,
        releaseShape: registerShapeContainer(element, options.radius ?? 8),
        clip: element.style.clipPath,
        borderRadius: element.style.borderRadius,
        backdropFilter: element.style.backdropFilter,
        boxShadow: element.style.boxShadow,
        layoutWidth: 0,
        layoutHeight: 0,
        visible: true,
        x: 0,
        y: 0,
        w: 0,
        h: 0,
        opacity: 1,
        animators: [],
        specularAngle: restingAngle,
      };
      if (options.specular) {
        lens.specular = createSpecularLayer(
          element,
          specularDefs,
          `lg-${owner}-light${lens.serial}`,
        );
        if (lens.specular && litCount++ === 0)
          lit = subscribeLight(root.ownerDocument.defaultView ?? window, () => ticker.wake());
      }
      const motion = () => resolveMotion(options.motion);
      if (options.interactive) {
        lens.animators.push(attachInteraction(element, motion));
        if (element.dataset.glassInteractive !== "") element.dataset.glassInteractive = "";
      }
      // Attributes the React layer already rendered are left untouched: a
      // rewrite during mount forces a style recalc before the next read.
      const previousAppearance = element.getAttribute("data-glass-appearance");
      if (previousAppearance !== (options.appearance ?? "light"))
        element.dataset.glassAppearance = options.appearance ?? "light";
      lenses.add(lens);
      ticker.observe(element);
      visibility?.observe(element);
      structure++;
      dirty = true;
      // A popup raises its scene above sibling scenes while it is present,
      // and keeps its contents hidden until its glass is drawn, so it never
      // shows as text without glass. A popup whose glass cannot be drawn
      // shows after a short wait.
      if (options.popup) {
        popups++;
        root.dataset.glassPopup = "";
        element.dataset.glassPending = "";
        const reveal = () => {
          if (!lens.pending) return;
          clearTimeout(lens.pending.timer);
          lens.pending = undefined;
          delete element.dataset.glassPending;
        };
        lens.pending = { reveal, timer: setTimeout(reveal, 250) };
      }
      ticker.wake();
      return () => {
        lens.pending?.reveal();
        lens.animators.forEach((animator) => animator.dispose());
        releaseSpecular(lens);
        if (options.interactive) delete element.dataset.glassInteractive;
        setResolvedShape(element);
        lens.releaseShape();
        restoreForeground(element);
        restoreSurface(lens);
        lenses.delete(lens);
        structure++;
        ticker.unobserve(element);
        visibility?.unobserve(element);
        if (options.popup && --popups === 0) delete root.dataset.glassPopup;
        if (previousAppearance === null) element.removeAttribute("data-glass-appearance");
        else element.setAttribute("data-glass-appearance", previousAppearance);
        dirty = true;
        // Glass leaves in the frame its surface does.
        ticker.flush();
      };
    },
    updateSurface(element, next) {
      const lens = [...lenses].find((l) => l.element === element);
      if (!lens) return;
      if (!Number.isFinite(next.refraction ?? 60) || (next.refraction ?? 60) < 0)
        throw new RangeError("Refraction must be finite and nonnegative.");
      const authored = authoredTint({
        ...lens.options,
        ...(lens.tintSource === undefined ? {} : { tint: lens.tintSource }),
        ...next,
      });
      const options = {
        ...authored.options,
        tint: authored.source ? lens.options.tint : authored.options.tint,
      };
      const sourceChanged = authored.source !== lens.tintSource;
      lens.tintSource = authored.source;
      if (
        !sourceChanged &&
        (
          [
            "material",
            "appearance",
            "tint",
            "frost",
            "refraction",
            "floating",
            "aberration",
          ] as const
        ).every((key) => options[key] === lens.options[key])
      )
        return;
      lens.options = options;
      const appearance = options.appearance ?? "light";
      if (element.dataset.glassAppearance !== appearance)
        element.dataset.glassAppearance = appearance;
      structure++;
      dirty = true;
      ticker.wake();
    },
    addForeground(element) {
      const target = {
        element,
        serial: ++lensSerial,
        x: 0,
        y: 0,
        w: 0,
        h: 0,
        opacity: 1,
        options: {},
      };
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
      return () => {
        animators.delete(animator);
        animator.dispose();
        ticker.wake();
      };
    },
    addProgressiveBlur: (element, options) => {
      const remove = progressive.add(element, options);
      ticker.wake();
      return () => {
        remove();
        ticker.wake();
      };
    },
    addScrollEdges: (options) => {
      const remove = progressive.addScroll(options);
      ticker.wake();
      return () => {
        remove();
        ticker.wake();
      };
    },
    dispose() {
      clearTimeout(warmRenderer);
      clearTimeout(warmStyle);
      progressive.dispose();
      layers?.dispose();
      escapes?.dispose();
      for (const [element, style] of layerStyles) releaseFilter(element, style);
      layerStyles.clear();
      warmer.dispose();
      animators.forEach((animator) => animator.dispose());
      animators.clear();
      disposed = true;
      ticker.dispose();
      visibility?.disconnect();
      if (content) releaseContent(content);
      for (const element of foregroundStyles.keys()) restoreForeground(element);
      svg.remove();
      releaseSceneLayer?.();
      unregisterRoot();
      lenses.forEach((lens) => {
        lens.animators.forEach((animator) => animator.dispose());
        releaseSpecular(lens);
        setResolvedShape(lens.element);
        lens.releaseShape();
        restoreSurface(lens);
      });
      lenses.clear();
      foregrounds.clear();
    },
  };
}

export {
  registerShapeContainer,
  observeConcentricShape,
  observeCornerPlacement,
} from "./shape-layout.js";
export type { ConcentricOptions, CornerOptions, GlassCornerPosition } from "./shape-layout.js";
