import {
  physicalEdge,
  scrollEdgeStrength,
  validateProgressive,
} from "../core/progressive.js";
import type {
  GlassBlurEdge,
  PhysicalEdge,
  ProgressiveBlurOptions,
} from "../core/progressive.js";
import { filterBudgetFactor, filterGraphOutsets, outsetBudget } from "./filter-budget.js";
import { padRepaintReach, repaintReach } from "./filter-reach.js";
import { filterPrimitiveCount } from "./filter-stages.js";
import { gecko, webkit } from "./engine.js";
import { acquireFilterPaintRoot } from "./filter-paint-root.js";
import { patchFilters } from "./filter-patch.js";
import { pngDataUrlSync } from "./png.js";
export type GlassScrollTarget =
  HTMLElement | (() => HTMLElement | null);
export interface ScrollEdgesOptions extends Omit<
  ProgressiveBlurOptions,
  "edge"
> {
  /** Scrollport to blur. Only this element is filtered; siblings stay sharp. */
  target: GlassScrollTarget;
  edges?: readonly GlassBlurEdge[];
}
type Registration = {
  element?: HTMLElement;
  options: ProgressiveBlurOptions;
  target?: GlassScrollTarget;
};
interface Box { x: number; y: number; width: number; height: number }
export type FilterEngine = "chromium" | "webkit" | "gecko";
const engine: FilterEngine = webkit ? "webkit" : gecko ? "gecko" : "chromium";
export interface ProgressiveRegion extends Box {
  edge: PhysicalEdge;
  blur: number;
  refraction: number;
}
let serial = 0;
const ns = "http://www.w3.org/2000/svg";

/** Blur levels between sharp and full strength. Level `i` blurs by
 * `blur · (i / levels)²` and is weighted by a triangle over the eased depth,
 * so neighboring levels cross-fade and every point sums to one. */
const levels = 6;
const ease = (u: number) => u * u * (3 - 2 * u);
/** Inverse of `ease` on [0, 1]. */
const unease = (d: number) => 0.5 - Math.sin(Math.asin(1 - 2 * Math.max(0, Math.min(1, d))) / 3);
const weight = (level: number, u: number) => Math.max(0, 1 - Math.abs(levels * ease(Math.max(0, Math.min(1, u))) - level));
/** The part of the depth, from the sharp side (0) to the edge (1), where a
 * level contributes. Each level only blurs this band: a third of the depth. */
const bands = Array.from({ length: levels + 1 }, (_, level) => [unease((level - 1) / levels), unease((level + 1) / levels)] as const);
/** Optical travel of each level, pushing content away from the edge. */
const travel = (level: number) => { const d = level / levels; return 0.98 * 4 * d * (1 - d); };

/** Standard normal CDF, Abramowitz–Stegun 7.1.26. */
function normal(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x / 2);
  return x < 0 ? (1 - y) / 2 : (1 + y) / 2;
}
function inverseNormal(p: number): number {
  let lo = -8, hi = 8;
  for (let i = 0; i < 48; i++) { const mid = (lo + hi) / 2; if (normal(mid) < p) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}
/** A flood over the edge half of a region, blurred along the depth with
 * σ = depth / 6, rises as Φ(6u − 3) across it. These tables map that ramp
 * to each level's weight. Floods, blurs, transfers and composites are the
 * primitives Gecko renders on the GPU; an image anywhere in the graph sends
 * the whole element to its software fallback. */
export const rampTables = Array.from({ length: levels + 1 }, (_, level) => Array.from({ length: 65 }, (_, n) => {
  const a = n / 64;
  const u = a <= 0 ? 0 : a >= 1 ? 1 : 0.5 + inverseNormal(a) / 6;
  return Number(weight(level, u).toFixed(4));
}).join(" "));
/** WebKit filters in software and charges a blur's outsets once for every
 * consumer of its result, so a shared ramp would grow its buffer sevenfold.
 * There each level's weight is a small image spanning only its band. */
const maskSamples = 64;
const masks = new Map<string, string>();
export function maskUrl(token: string): string | undefined {
  const cached = masks.get(token);
  if (cached) return cached;
  const [, edge, index] = token.split(":") as [string, PhysicalEdge, string];
  const level = Number(index);
  const [lo, hi] = bands[level]!;
  const vertical = edge === "top" || edge === "bottom";
  // Pixels run left to right and top to bottom; top and left edges are
  // strongest at the start of the band.
  const reverse = edge === "top" || edge === "left";
  const pixels = new Uint8Array(maskSamples * 4);
  for (let k = 0; k < maskSamples; k++) {
    const f = (k + 0.5) / maskSamples;
    const u = reverse ? hi - f * (hi - lo) : lo + f * (hi - lo);
    pixels.set([255, 255, 255, Math.round(255 * weight(level, u))], k * 4);
  }
  const url = pngDataUrlSync(vertical ? 1 : maskSamples, vertical ? maskSamples : 1, pixels);
  masks.set(token, url);
  return url;
}

const round = (box: Box): Box => {
  const x = Math.floor(box.x), y = Math.floor(box.y);
  return { x, y, width: Math.ceil(box.x + box.width) - x, height: Math.ceil(box.y + box.height) - y };
};
const attributes = (box: Box) => `x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}"`;
const grow = (box: Box, by: number): Box => ({ x: box.x - by, y: box.y - by, width: box.width + 2 * by, height: box.height + 2 * by });
/** The part of a region between depths `from` and `to`, where 0 is the sharp
 * side and 1 the edge. Depths past 1 continue beyond the edge. */
function along(r: ProgressiveRegion, from: number, to: number): Box {
  switch (r.edge) {
    case "bottom": return round({ x: r.x, y: r.y + from * r.height, width: r.width, height: (to - from) * r.height });
    case "top": return round({ x: r.x, y: r.y + (1 - to) * r.height, width: r.width, height: (to - from) * r.height });
    case "right": return round({ x: r.x + from * r.width, y: r.y, width: (to - from) * r.width, height: r.height });
    case "left": return round({ x: r.x + (1 - to) * r.width, y: r.y, width: (to - from) * r.width, height: r.height });
  }
}
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** The blurred, weighted levels of one region, whose sum is its result. */
function levelParts(r: ProgressiveRegion, p: string, source: string, imageMasks: boolean, full?: Box): { markup: string[]; even: string[]; odd: string[] } {
  const markup: string[] = [];
  const vertical = r.edge === "top" || r.edge === "bottom";
  const away = r.edge === "bottom" || r.edge === "right" ? -1 : 1;
  const depth = vertical ? r.height : r.width;
  if (!imageMasks) {
    const sigma = depth / 6;
    markup.push(
      `<feFlood flood-color="#fff" ${attributes(along(r, 0.5, 1.5))} result="${p}step"/>`,
      `<feGaussianBlur in="${p}step" stdDeviation="${vertical ? `0 ${sigma}` : `${sigma} 0`}" ${attributes(round(r))} result="${p}ramp"/>`,
    );
  }
  const even: string[] = [], odd: string[] = [];
  for (let level = 0; level <= levels; level++) {
    const band = along(r, bands[level]![0], bands[level]![1]);
    // The sharp level can cover everything outside the region too, where its
    // weight is one, instead of a separate pass that cuts the region out. It
    // needs the full extent explicitly: by default a primitive covers only
    // the union of its inputs, here the ramp's region.
    const region = ` ${attributes(level === 0 && full ? full : band)}`;
    const sigma = r.blur * (level / levels) ** 2;
    let input = source;
    const shift = r.refraction * travel(level);
    if (shift > 0.01) {
      const offset = (shift * away).toFixed(3);
      markup.push(`<feOffset in="${source}" dx="${vertical ? 0 : offset}" dy="${vertical ? offset : 0}" ${attributes(grow(band, Math.ceil(3 * sigma) + 1))} result="${p}shift${level}"/>`);
      input = `${p}shift${level}`;
    }
    if (level) {
      markup.push(`<feGaussianBlur in="${input}" stdDeviation="${sigma}" ${attributes(band)} result="${p}blur${level}"/>`);
      input = `${p}blur${level}`;
    }
    markup.push(imageMasks
      ? `<feImage data-map="pg:${r.edge}:${level}" preserveAspectRatio="none" ${attributes(band)} result="${p}weight${level}"/>`
      : `<feComponentTransfer in="${p}ramp"${region} result="${p}weight${level}"><feFuncA type="table" tableValues="${rampTables[level]}"/></feComponentTransfer>`);
    markup.push(`<feComposite in="${input}" in2="${p}weight${level}" operator="in"${region} result="${p}part${level}"/>`);
    // Alternate levels never overlap, so a merge adds them exactly.
    (level % 2 ? odd : even).push(`${p}part${level}`);
  }
  return { markup, even, odd };
}
/** One filter graph that keeps the sharp source and blurs only near edges. */
export function progressiveGraph(id: string, regions: ProgressiveRegion[], width: number, height: number, target: FilterEngine = engine): string {
  // Preserve foreground overflow (focus rings, shadows, scene popups) and
  // the ramp's flood, which extends half a depth past each edge.
  const padding = Math.max(256, ...regions.map((r) => Math.ceil((r.edge === "top" || r.edge === "bottom" ? r.height : r.width) / 2 + 3 * r.blur + r.refraction + 8)));
  const full = { x: -padding, y: -padding, width: width + 2 * padding, height: height + 2 * padding };
  const parts: string[] = [];
  const merge = (inputs: string[], result: string, box?: Box) =>
    `<feMerge result="${result}"${box ? ` ${attributes(box)}` : ""}>${inputs.map((input) => `<feMergeNode in="${input}"/>`).join("")}</feMerge>`;
  // A sum. Software filters draw "lighter" as a plus-lighter blend; an
  // arithmetic composite converts and clamps every pixel. Gecko keeps the
  // arithmetic form, which WebRender renders natively on the GPU.
  const add = (a: string, b: string, result: string, box?: Box) => target === "gecko"
    ? `<feComposite in="${a}" in2="${b}" operator="arithmetic" k2="1" k3="1"${box ? ` ${attributes(box)}` : ""} result="${result}"/>`
    : `<feComposite in="${a}" in2="${b}" operator="lighter"${box ? ` ${attributes(box)}` : ""} result="${result}"/>`;
  if (target === "gecko") {
    // Gecko renders this on the GPU, where a full-size pass is cheap and a
    // primitive is not: its limit is 64 for every filter on the element.
    let source = "SourceGraphic";
    regions.forEach((r, index) => {
      const p = `e${index}`;
      const { markup, even, odd } = levelParts(r, p, source, false, full);
      parts.push(...markup, merge(even, `${p}even`, full), merge(odd, `${p}odd`, round(r)), add(`${p}even`, `${p}odd`, `${p}result`, full));
      source = `${p}result`;
    });
  } else {
    // Software filters pay for every pixel a primitive covers. Regions that
    // do not overlap read the same source and replace it in one final pass.
    const independent = regions.every((r, i) => regions.every((other, j) => i === j || !overlaps(round(r), round(other))));
    const groups = independent ? [regions] : regions.map((r) => [r]);
    let source = "SourceGraphic";
    groups.forEach((group, g) => {
      const results: string[] = [], areas: string[] = [];
      group.forEach((r) => {
        const index = regions.indexOf(r), p = `e${index}`;
        const { markup, even, odd } = levelParts(r, p, source, target === "webkit");
        parts.push(...markup, `<feFlood flood-color="#fff" ${attributes(round(r))} result="${p}area"/>`,
          merge(even, `${p}even`, round(r)), merge(odd, `${p}odd`, round(r)), add(`${p}even`, `${p}odd`, `${p}result`, round(r)));
        results.push(`${p}result`);
        areas.push(`${p}area`);
      });
      const q = `g${g}`;
      if (areas.length > 1) parts.push(merge(areas, `${q}areas`));
      parts.push(`<feComposite in="${source}" in2="${areas.length > 1 ? `${q}areas` : areas[0]}" operator="out" result="${q}outside"/>`,
        merge([`${q}outside`, ...results], `${q}result`));
      source = `${q}result`;
    });
  }
  return `<filter id="${id}" x="${-padding / width}" y="${-padding / height}" width="${1 + (2 * padding) / width}" height="${1 + (2 * padding) / height}" filterUnits="objectBoundingBox" primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB">${parts.join("")}</filter>`;
}
export function createProgressiveLayer(
  root: HTMLElement,
  onError: (error: Error) => void,
  viewportMode = false,
) {
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.style.cssText = "position:absolute;pointer-events:none;overflow:hidden";
  const defs = document.createElementNS(ns, "defs");
  svg.append(defs);
  // Definitions must live outside the filtered wrapper to avoid a filter dependency cycle.
  root.ownerDocument.body.append(svg);
  const id = `lg-progressive-${++serial}`;
  const registrations = new Set<Registration>();
  const scrollRegistrations = new Set<ScrollEdgesOptions>();
  type ViewportLayer = {
    layer: ReturnType<typeof createProgressiveLayer>;
    options: ScrollEdgesOptions[];
    remove: (() => void)[];
    original: string;
    applied: string;
    releasePaint?: () => void;
  };
  let currentOutsets = 0;
  let scrollsContent = false;
  let budgetKey = "", budgetOutsets = 0;
  const viewports = new Map<HTMLElement, ViewportLayer>();
  function releaseViewport(element: HTMLElement, state: ViewportLayer) {
    if (element.style.filter === state.applied) element.style.filter = state.original;
    state.layer.dispose();
    state.releasePaint?.();
    viewports.delete(element);
  }
  function updateViewports(content: HTMLElement | null) {
    const groups = new Map<HTMLElement, ScrollEdgesOptions[]>();
    for (const options of scrollRegistrations) {
      const scroller = typeof options.target === "function" ? options.target() : options.target;
      if (scroller === content) continue;
      // Filter the scrollport itself. Safari's accelerated scrolling content
      // bypasses a reference filter applied to a separate ancestor.
      const element = scroller;
      if (!element) continue;
      const group = groups.get(element) ?? [];
      group.push(options);
      groups.set(element, group);
    }
    for (const [element, state] of viewports) {
      if (!groups.has(element)) releaseViewport(element, state);
    }
    let count = 0;
    for (const [element, options] of groups) {
      let state = viewports.get(element);
      if (!state) {
        state = { layer: createProgressiveLayer(root, onError, true), options: [], remove: [], original: element.style.filter, releasePaint: webkit ? acquireFilterPaintRoot(element) : undefined, applied: element.style.filter };
        viewports.set(element, state);
      }
      if (options.length !== state.options.length || options.some((o, i) => o !== state.options[i])) {
        state.remove.forEach((remove) => remove());
        state.remove = options.map((o) => state!.layer.addScroll(o));
        state.options = options;
      }
      const effect = state.layer.update(element);
      const next = [state.original, effect].filter(Boolean).join(" ");
      if (element.style.filter !== next) element.style.filter = next;
      state.applied = next;
      count += state.layer.count();
    }
    return count;
  }
  const reduced = matchMedia("(prefers-reduced-transparency: reduce)");
  const contrast = matchMedia("(forced-colors: active)");
  let markup = "", filter = "", regionCount = 0;
  /** Regions drawn this frame, in the target's coordinates. */
  let current: ProgressiveRegion[] = [];
  let graphError: Error | undefined;
  let graphOperations = 0;
  // Written every frame otherwise; an unchanged value must not restyle the scene.
  const setEdges = (value: string) => { if (root.dataset.glassBlurEdges !== value) root.dataset.glassBlurEdges = value; };
  function clear() {
    current = [];
    if (markup) patchFilters(defs, [], maskUrl);
    markup = "";
    filter = "";
    regionCount = 0;
    graphError = undefined;
    graphOperations = 0;
    if (!viewportMode) setEdges("0");
  }
  const registeredCount = () => registrations.size + [...scrollRegistrations].reduce(
    (sum, options) => sum + new Set(options.edges ?? ["top", "bottom"]).size, 0,
  );
  function add(registration: Registration) {
    validateProgressive(registration.options);
    if (registeredCount() >= 64)
      throw new RangeError(
        "A GlassScene supports at most 64 progressive blur regions.",
      );
    registrations.add(registration);
    return () => {
      registrations.delete(registration);
    };
  }
  return {
    add(element: HTMLElement, options: ProgressiveBlurOptions = {}) {
      return add({ element, options });
    },
    addScroll(options: ScrollEdgesOptions) {
      const edges = [...new Set(options.edges ?? (["top", "bottom"] as const))];
      validateProgressive(options);
      edges.forEach((edge) => validateProgressive({ edge }));
      if (registeredCount() + edges.length > 64)
        throw new RangeError(
          "A GlassScene supports at most 64 progressive blur regions.",
        );
      if (!viewportMode) {
        scrollRegistrations.add(options);
        return () => { scrollRegistrations.delete(options); };
      }
      const remove = edges.map((edge) =>
        add({ options: { ...options, edge }, target: options.target }),
      );
      return () => remove.forEach((cleanup) => cleanup());
    },
    count(): number { return regionCount; },
    /** Regions blurred directly on the scene's own target, as of the last update. */
    regions(): readonly ProgressiveRegion[] { return current; },
    operations(): number { return graphOperations; },
    outsets(): number { return currentOutsets; },
    scrollsContent(): boolean { return scrollsContent; },
    error(): Error | undefined {
      return graphError ?? [...viewports.values()].map((state) => state.layer.error()).find(Boolean);
    },
    update(content: HTMLElement | null): string {
      currentOutsets = 0;
      const viewportCount = viewportMode ? 0 : updateViewports(content);
      if (!viewportMode) setEdges(String(viewportCount));
      const direct = [...scrollRegistrations].filter((o) => (typeof o.target === "function" ? o.target() : o.target) === content)
        .flatMap((o) => [...new Set(o.edges ?? (["top", "bottom"] as const))].map((edge) => ({ options: { ...o, edge }, target: o.target }) as Registration));
      scrollsContent = direct.length > 0;
      const active = [...registrations, ...direct];
      if (
        !content ||
        reduced.matches ||
        contrast.matches ||
        !active.length
      ) {
        if (markup || filter) clear();
        if (!viewportMode) setEdges(String(viewportCount));
        return "";
      }
      const c = content.getBoundingClientRect();
      const width = content.offsetWidth,
        height = content.offsetHeight;
      if (!width || !height || !c.width || !c.height) {
        clear();
        return "";
      }
      const sx = width / c.width,
        sy = height / c.height;
      const regions: ProgressiveRegion[] = [];
      for (const { element, options: o, target } of active) {
        if (
          o.disabled ||
          !(o.size ?? 80) ||
          (!(o.blur ?? 20) && !(o.refraction ?? 0))
        )
          continue;
        const scroller =
          typeof target === "function" ? target() : target;
        if (target && !scroller) continue;
        const rtl = getComputedStyle(scroller ?? root).direction === "rtl";
        const edge = physicalEdge(o.edge ?? "bottom", rtl);
        const vertical = edge === "top" || edge === "bottom";
        let rect = element?.getBoundingClientRect();
        let strength = 1;
        if (scroller) {
          const viewportWidth = scroller.clientWidth;
          const viewportHeight = scroller.clientHeight;
          const s = scroller.getBoundingClientRect();
          const scaleX = s.width / (scroller.offsetWidth || 1);
          const scaleY = s.height / (scroller.offsetHeight || 1);
          const x = s.left + scroller.clientLeft * scaleX;
          const y = s.top + scroller.clientTop * scaleY;
          const depth = Math.min(
            o.size ?? 80,
            (vertical ? viewportHeight : viewportWidth) / 2,
          );
          strength = scrollEdgeStrength(
            edge,
            scroller.scrollLeft,
            scroller.scrollTop,
            Math.max(0, scroller.scrollWidth - viewportWidth),
            Math.max(0, scroller.scrollHeight - viewportHeight),
            rtl,
            depth,
          );
          rect = new DOMRect(
            edge === "right" ? x + (viewportWidth - depth) * scaleX : x,
            edge === "bottom" ? y + (viewportHeight - depth) * scaleY : y,
            (vertical ? viewportWidth : depth) * scaleX,
            (vertical ? depth : viewportHeight) * scaleY,
          );
        }
        if (
          !rect ||
          !strength ||
          rect.bottom < 0 ||
          rect.top > innerHeight ||
          rect.right < 0 ||
          rect.left > innerWidth
        )
          continue;
        // Clip only across the gradient, preserving its full depth/profile.
        const left = vertical ? Math.max(rect.left, c.left) : rect.left;
        const top = vertical ? rect.top : Math.max(rect.top, c.top);
        const right = vertical ? Math.min(rect.right, c.right) : rect.right;
        const bottom = vertical ? rect.bottom : Math.min(rect.bottom, c.bottom);
        if (
          right <= left ||
          bottom <= top ||
          rect.bottom <= c.top ||
          rect.top >= c.bottom ||
          rect.right <= c.left ||
          rect.left >= c.right
        )
          continue;
        regions.push({
          edge,
          x: (left - c.left) * sx,
          y: (top - c.top) * sy,
          width: (right - left) * sx,
          height: (bottom - top) * sy,
          blur: (o.blur ?? 20) * strength,
          refraction: (o.refraction ?? 0) * strength,
        });
      }
      current = regions;
      if (!regions.length) {
        if (markup || filter) clear();
        if (!viewportMode) setEdges(String(viewportCount));
        return "";
      }
      // The whole branched graph counts, including repeated inputs from an
      // earlier edge. Cache this across scrolling that only moves regions.
      const scale = typeof devicePixelRatio === "number" && devicePixelRatio > 0 ? devicePixelRatio : 1;
      if (webkit) {
        const nextBudgetKey = JSON.stringify([width, height, ...regions.map((r) => [r.edge, r.width, r.height, r.blur, r.refraction])]);
        if (nextBudgetKey !== budgetKey) {
          budgetKey = nextBudgetKey;
          budgetOutsets = filterGraphOutsets(progressiveGraph(id, regions, width, height));
        }
        const outsets = budgetOutsets * scale;
        const soften = filterBudgetFactor(width * scale, height * scale, outsets);
        currentOutsets = outsets * soften / scale;
        if (soften < 1) for (const r of regions) { r.blur *= soften; r.refraction *= soften; }
      }
      let next = progressiveGraph(id, regions, width, height);
      if (webkit) {
        // Blur bands sit at the edges; a repaint across the element must reach
        // them. Leave half the budget to glass chained on the same element.
        const pad = Math.min(repaintReach(next, width, height), outsetBudget(width * scale, height * scale) / scale / 2);
        if (pad > currentOutsets) { next = padRepaintReach(next, Math.floor(pad), width, height); currentOutsets = Math.floor(pad); }
      }
      if (next !== markup) {
        markup = next;
        regionCount = regions.length;
        graphOperations = gecko ? filterPrimitiveCount(next) : 0;
        graphError = graphOperations > 64 ? new RangeError(`Progressive blur requires ${graphOperations} filter operations; this browser supports 64 per element.`) : undefined;
        const live = patchFilters(defs, [next], maskUrl);
        filter = `url("#${live(id)}")`;
      }
      if (!viewportMode) setEdges(String(viewportCount + regions.length));
      return filter;
    },
    dispose() {
      registrations.clear();
      scrollRegistrations.clear();
      for (const [element, state] of viewports) releaseViewport(element, state);
      svg.remove();
      if (!viewportMode) delete root.dataset.glassBlurEdges;
    },
  };
}
