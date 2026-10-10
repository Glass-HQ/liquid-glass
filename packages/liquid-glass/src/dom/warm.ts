import type { MaterialMaps } from "./maps.js";

const ns = "http://www.w3.org/2000/svg";
// Firefox drops a CSS filter chain above 64 primitives. Each independent
// probe has at most 48 image primitives and one merge, with 96 URLs retained.
const imagesPerProbe = 48;
const retainedImages = 96;
/** First-use grace shared by map admission and scene animation readiness. */
export const mapWarmup = 50;
let serial = 0;

/** Chromium draws a newly referenced filter image blank until it has been
 * loaded and decoded for painting, which reads as the glass blinking when an
 * animation switches maps. A warmer paints every new map once, through its
 * own filter on a 1 × 1, nearly transparent element, as soon as the map is
 * prepared, so the image is ready by the time a surface switches to it. */
export function createMapWarmer(root: HTMLElement) {
  const id = `lg-warm-${++serial}`;
  const document = root.ownerDocument;
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.style.position = "absolute";
  root.append(svg);
  const probes: { filter: SVGElement; merge: SVGElement; element: HTMLElement; count: number }[] = [];
  const createProbe = () => {
    const filter = document.createElementNS(ns, "filter");
    filter.id = `${id}-${probes.length}`;
    for (const [name, value] of Object.entries({ x: "0", y: "0", width: "1", height: "1", filterUnits: "objectBoundingBox", primitiveUnits: "objectBoundingBox" }))
      filter.setAttribute(name, value);
    svg.append(filter);
    const element = document.createElement("div");
    element.setAttribute("aria-hidden", "true");
    Object.assign(element.style, { position: "absolute", left: "0", top: "0", width: "1px", height: "1px", opacity: "0.004", pointerEvents: "none", filter: `url("#${filter.id}")` });
    root.append(element);
    const merge = document.createElementNS(ns, "feMerge");
    filter.append(merge);
    const probe = { filter, merge, element, count: 0 };
    probes.push(probe);
    return probe;
  };
  createProbe();
  // Each warmed image is one primitive and one merge input, oldest first.
  const warmed = new Map<string, { image: SVGElement; node: SVGElement; probe: (typeof probes)[number] }>();
  // A live decoded map does not need a new probe every time its old probe
  // slot is reused. Only remember preparations that survived the same grace
  // period as their first use. A burst can evict maps before that happens.
  const prepared = new WeakSet<MaterialMaps>();
  const pending = new Map<MaterialMaps, number>();
  let preparationTimer: ReturnType<typeof setTimeout> | undefined;
  let next = 0;
  const add = (url: string) => {
    if (warmed.has(url)) return;
    if (warmed.size >= retainedImages) {
      const [oldUrl, old] = warmed.entries().next().value!;
      old.image.remove(); old.node.remove(); old.probe.count--;
      warmed.delete(oldUrl);
    }
    const probe = probes.find((probe) => probe.count < imagesPerProbe) ?? createProbe();
    const name = `w${++next}`;
    const image = document.createElementNS(ns, "feImage");
    for (const [key, value] of Object.entries({ x: "0", y: "0", width: "1", height: "1", preserveAspectRatio: "none", result: name }))
      image.setAttribute(key, value);
    const node = document.createElementNS(ns, "feMergeNode");
    node.setAttribute("in", name);
    probe.filter.insertBefore(image, probe.merge);
    probe.merge.append(node);
    image.setAttribute("href", url);
    probe.count++;
    warmed.set(url, { image, node, probe });
  };
  let touches = 0;
  let disposed = false;
  let timers: ReturnType<typeof setTimeout>[] = [];
  const repaint = () => {
    // The filter does not repaint by itself when its images arrive. A real
    // change also brings up WebKit's filter renderer, whose first evaluation
    // on a page stalls for over a second; better here than on a gesture.
    const generation = ++touches;
    timers.forEach(clearTimeout);
    timers = [16, 60, 150].map((delay) => setTimeout(() => {
      if (touches === generation && !disposed)
        for (const { filter } of probes) filter.setAttribute("x", filter.getAttribute("x") === "0" ? "0.000001" : "0");
    }, delay));
  };
  const urls = (maps: MaterialMaps) => [maps.field, maps.overlay, ...Object.values(maps.capsule?.planes ?? {}).flat()];
  const completePreparations = () => {
    const now = performance.now();
    for (const [maps, ready] of pending) if (ready <= now) {
      if (urls(maps).every((url) => warmed.has(url))) prepared.add(maps);
      pending.delete(maps);
    }
  };
  const schedulePreparation = () => {
    if (preparationTimer !== undefined || !pending.size) return;
    const next = Math.min(...pending.values());
    preparationTimer = setTimeout(() => {
      preparationTimer = undefined;
      if (disposed) return;
      completePreparations();
      schedulePreparation();
    }, Math.max(0, next - performance.now()));
  };
  return {
    warm(maps: MaterialMaps) {
      if (disposed) return;
      completePreparations();
      if (prepared.has(maps)) return;
      const fresh = urls(maps).filter((url) => !warmed.has(url));
      if (fresh.length) {
        for (const url of fresh) add(url);
        repaint();
      }
      if (fresh.length || !pending.has(maps)) pending.set(maps, performance.now() + mapWarmup);
      schedulePreparation();
    },
    /** Whether these maps completed a preparation attempt and its grace
     * period. Browser filter painting itself has no completion signal. */
    has(maps: MaterialMaps) {
      if (disposed) return false;
      completePreparations();
      return prepared.has(maps);
    },
    /** Whether a node is part of the warmer's own markup. */
    owns(node: Node) {
      return svg.contains(node) || probes.some((probe) => probe.element.contains(node));
    },
    dispose() {
      disposed = true;
      timers.forEach(clearTimeout);
      timers = [];
      if (preparationTimer !== undefined) clearTimeout(preparationTimer);
      preparationTimer = undefined;
      pending.clear();
      svg.remove();
      for (const { element } of probes) element.remove();
      warmed.clear();
    },
  };
}
