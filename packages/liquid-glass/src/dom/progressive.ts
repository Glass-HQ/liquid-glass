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
import { getProgressiveMaps } from "./progressive-maps.js";
import { blurOutsets, filterBudgetFactor, webkit } from "./filter-budget.js";
/** The scroller's parent when it is a clipping wrapper holding nothing else. */
function stillFrame(scroller: HTMLElement): HTMLElement | undefined {
  const parent = scroller.parentElement;
  if (!parent || parent.childElementCount !== 1 || parent.classList.contains("lg-content")) return;
  const overflow = getComputedStyle(parent).overflow;
  return /hidden|clip/.test(overflow) ? parent : undefined;
}
import type { ProgressiveMaps } from "./progressive-maps.js";
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
type Region = {
  edge: PhysicalEdge;
  x: number;
  y: number;
  width: number;
  height: number;
  blur: number;
  refraction: number;
  maps: ProgressiveMaps;
};
let serial = 0;
const ns = "http://www.w3.org/2000/svg";
/** One filter graph, including sharp source, with bounded blur intermediates. */
function graph(
  id: string,
  regions: Region[],
  width: number,
  height: number,
): string {
  const parts: string[] = [];
  let source = "SourceGraphic";
  const box = (x: number, y: number, w: number, h: number) =>
    `x="${x / width}" y="${y / height}" width="${w / width}" height="${h / height}"`;
  regions.forEach((r, index) => {
    const p = `e${index}`;
    const bounds = `${box(r.x, r.y, r.width, r.height)} data-region="${index}" data-box="bounds"`;
    const margin = Math.ceil(3 * r.blur + r.refraction + 2);
    const crop = `${box(r.x - margin, r.y - margin, r.width + margin * 2, r.height + margin * 2)} data-region="${index}" data-box="crop"`;
    parts.push(
      `<feFlood ${bounds} flood-color="white" result="${p}area"/>`,
      `<feComposite in="${source}" in2="${p}area" operator="out" result="${p}outside"/>`,
    );
    let input = source;
    if (r.refraction > 0) {
      parts.push(
        `<feImage href="${r.maps.displacement}" ${bounds} preserveAspectRatio="none" result="${p}raw"/>`,
        `<feFlood flood-color="rgb(128,128,128)" result="${p}neutral"/><feComposite in="${p}raw" in2="${p}neutral" operator="over" result="${p}filled"/><feComponentTransfer in="${p}filled" result="${p}map"><feFuncR type="linear" slope="1" intercept="${0.5 - 128 / 255}"/><feFuncG type="linear" slope="1" intercept="${0.5 - 128 / 255}"/></feComponentTransfer>`,
        `<feDisplacementMap in="${source}" in2="${p}map" ${crop} scale="${(r.refraction * 2) / width}" xChannelSelector="R" yChannelSelector="G" result="${p}refracted"/>`,
      );
      input = `${p}refracted`;
    }
    r.maps.weights.forEach((url, i) => {
      const sigma = r.blur * (i / 6) ** 2;
      if (i)
        parts.push(
          `<feGaussianBlur in="${input}" ${crop} data-level="${i}" stdDeviation="${sigma / width} ${sigma / height}" result="${p}blur${i}"/>`,
        );
      parts.push(
        `<feImage href="${url}" ${bounds} preserveAspectRatio="none" result="${p}mask${i}"/>`,
        `<feComposite in="${i ? `${p}blur${i}` : input}" in2="${p}mask${i}" operator="in" ${bounds} result="${p}part${i}"/>`,
      );
      if (i)
        parts.push(
          `<feComposite in="${i === 1 ? `${p}part0` : `${p}sum${i - 1}`}" in2="${p}part${i}" operator="arithmetic" k2="1" k3="1" ${bounds} result="${p}sum${i}"/>`,
        );
    });
    parts.push(
      `<feMerge result="${p}result"><feMergeNode in="${p}outside"/><feMergeNode in="${p}sum6"/></feMerge>`,
    );
    source = `${p}result`;
  });
  const padding = 256; // Preserve foreground overflow (focus rings, shadows, scene popups).
  return `<filter id="${id}" x="${-padding / width}" y="${-padding / height}" width="${1 + (2 * padding) / width}" height="${1 + (2 * padding) / height}" filterUnits="objectBoundingBox" primitiveUnits="objectBoundingBox" color-interpolation-filters="sRGB">${parts.join("")}</filter>`;
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
  };
  const viewports = new Map<HTMLElement, ViewportLayer>();
  function releaseViewport(element: HTMLElement, state: ViewportLayer) {
    if (element.style.filter === state.applied) element.style.filter = state.original;
    state.layer.dispose();
    viewports.delete(element);
  }
  function updateViewports() {
    const groups = new Map<HTMLElement, ScrollEdgesOptions[]>();
    for (const options of scrollRegistrations) {
      const scroller = typeof options.target === "function" ? options.target() : options.target;
      // The scrollport is stationary even while its contents scroll. Filtering
      // its parent would also blur sibling toolbars and floating navigation.
      // WebKit paints nothing for a reference filter on a scroller itself, so
      // there a frame that holds only the scroller takes the filter instead.
      const element = scroller && webkit ? stillFrame(scroller) ?? scroller : scroller;
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
        state = { layer: createProgressiveLayer(root, onError, true), options: [], remove: [], original: element.style.filter, applied: element.style.filter };
        viewports.set(element, state);
      }
      if (options.length !== state.options.length || options.some((o, i) => o !== state.options[i])) {
        state.remove.forEach((remove) => remove());
        state.remove = options.map((o) => state!.layer.addScroll(o));
        state.options = options;
      }
      const effect = state.layer.update(element);
      // Filter only the stationary scrollport, never its parent or translated content.
      // Native asynchronous scrolling can now run without JS moving the mask.
      const next = [state.original, effect].filter(Boolean).join(" ");
      if (element.style.filter !== next) element.style.filter = next;
      state.applied = next;
      count += state.layer.count();
    }
    return count;
  }
  const maps = new Map<PhysicalEdge, ProgressiveMaps>();
  const pending = new Set<PhysicalEdge>();
  const failed = new Set<PhysicalEdge>();
  const reduced = matchMedia("(prefers-reduced-transparency: reduce)");
  const contrast = matchMedia("(forced-colors: active)");
  let previous = "",
    topology = "",
    filter = "",
    disposed = false;
  let nodes: SVGElement[] = [];
  // Written every frame otherwise; an unchanged value must not restyle the scene.
  const setEdges = (value: string) => { if (root.dataset.glassBlurEdges !== value) root.dataset.glassBlurEdges = value; };
  function clear() {
    svg.replaceChildren();
    previous = "";
    topology = "";
    filter = "";
    nodes = [];
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
    failed.clear(); // An explicit remount/update may retry a previously unavailable GPU.
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
    count(): number { return nodes.filter((node) => node.localName === "feFlood").length; },
    update(content: HTMLElement | null): string {
      const viewportCount = viewportMode ? 0 : updateViewports();
      if (!viewportMode) setEdges(String(viewportCount));
      if (
        !content ||
        reduced.matches ||
        contrast.matches ||
        !registrations.size
      ) {
        if (previous || filter) clear();
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
      const regions: Region[] = [];
      for (const { element, options: o, target } of registrations) {
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
        const m = maps.get(edge);
        if (!m) {
          if (!pending.has(edge) && !failed.has(edge)) {
            pending.add(edge);
            getProgressiveMaps(edge)
              .then((value) => {
                if (!disposed) maps.set(edge, value);
              })
              .catch((error) => {
                pending.delete(edge);
                failed.add(edge);
                if (!disposed)
                  onError(
                    error instanceof Error ? error : new Error(String(error)),
                  );
              });
          }
          continue;
        }
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
          maps: m,
        });
      }
      // Six blur levels and a displacement per edge all count against
      // WebKit's one buffer budget for the filtered element.
      const scale = typeof devicePixelRatio === "number" && devicePixelRatio > 0 ? devicePixelRatio : 1;
      const levels = [1, 2, 3, 4, 5, 6].reduce((sum, i) => sum + (i / 6) ** 2, 0);
      const outsets = regions.reduce((sum, r) => sum + scale * (blurOutsets(r.blur) * levels + r.refraction), 0);
      const soften = filterBudgetFactor(width * scale, height * scale, outsets);
      if (soften < 1) for (const r of regions) { r.blur *= soften; r.refraction *= soften; }
      const key = JSON.stringify([
        width,
        height,
        ...regions.map(({ maps: _maps, ...r }) => r),
      ]);
      if (key !== previous) {
        previous = key;
        const nextTopology =
          `${width}:${height}:` +
          regions.map((r) => `${r.edge}:${r.refraction > 0}`).join(",");
        if (topology !== nextTopology) {
          topology = nextTopology;
          svg.innerHTML = regions.length
            ? `<defs>${graph(id, regions, width, height)}</defs>`
            : "";
          nodes = [...svg.querySelectorAll<SVGElement>("[data-region]")];
        } else {
          // Keep feImage resources and the filter graph alive while scrolling.
          for (const node of nodes) {
            const r = regions[Number(node.dataset.region)]!;
            const margin =
              node.dataset.box === "crop"
                ? Math.ceil(3 * r.blur + r.refraction + 2)
                : 0;
            const values = {
              x: (r.x - margin) / width,
              y: (r.y - margin) / height,
              width: (r.width + 2 * margin) / width,
              height: (r.height + 2 * margin) / height,
            };
            for (const [name, value] of Object.entries(values))
              node.setAttribute(name, String(value));
            if (node.dataset.level) {
              const sigma = r.blur * (Number(node.dataset.level) / 6) ** 2;
              node.setAttribute(
                "stdDeviation",
                `${sigma / width} ${sigma / height}`,
              );
            }
            if (node.localName === "feDisplacementMap")
              node.setAttribute("scale", String((r.refraction * 2) / width));
          }
        }
        filter = regions.length ? `url("#${id}")` : "";
        if (!viewportMode) setEdges(String(viewportCount + regions.length));
      }
      return filter;
    },
    dispose() {
      disposed = true;
      registrations.clear();
      scrollRegistrations.clear();
      for (const [element, state] of viewports) releaseViewport(element, state);
      svg.remove();
      if (!viewportMode) delete root.dataset.glassBlurEdges;
    },
  };
}
