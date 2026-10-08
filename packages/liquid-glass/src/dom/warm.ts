import type { MaterialMaps } from "./maps.js";

const ns = "http://www.w3.org/2000/svg";
let serial = 0;

/** Chromium draws a newly referenced filter image blank until it has been
 * loaded and decoded for painting, which reads as the glass blinking when an
 * animation switches maps. A warmer paints every new map once, through its
 * own filter on a 1 × 1, nearly transparent element, as soon as the map is
 * prepared, so the image is ready by the time a surface switches to it. */
export function createMapWarmer(root: HTMLElement) {
  const id = `lg-warm-${++serial}`;
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.style.position = "absolute";
  const filter = document.createElementNS(ns, "filter");
  filter.id = id;
  for (const [name, value] of Object.entries({ x: "0", y: "0", width: "1", height: "1", filterUnits: "objectBoundingBox", primitiveUnits: "objectBoundingBox" }))
    filter.setAttribute(name, value);
  svg.append(filter);
  const probe = document.createElement("div");
  probe.setAttribute("aria-hidden", "true");
  Object.assign(probe.style, { position: "absolute", left: "0", top: "0", width: "1px", height: "1px", opacity: "0.004", pointerEvents: "none", filter: `url("#${id}")` });
  root.append(svg, probe);
  const merge = document.createElementNS(ns, "feMerge");
  filter.append(merge);
  // Each warmed image is one primitive and one merge input, oldest first.
  const warmed = new Map<string, [SVGElement, SVGElement]>();
  let next = 0;
  const add = (url: string) => {
    if (warmed.has(url)) return;
    const name = `w${++next}`;
    const image = document.createElementNS(ns, "feImage");
    for (const [key, value] of Object.entries({ x: "0", y: "0", width: "1", height: "1", preserveAspectRatio: "none", result: name }))
      image.setAttribute(key, value);
    const node = document.createElementNS(ns, "feMergeNode");
    node.setAttribute("in", name);
    filter.insertBefore(image, merge);
    merge.append(node);
    image.setAttribute("href", url);
    warmed.set(url, [image, node]);
  };
  const trim = () => {
    for (const [url, [image, node]] of warmed) {
      if (warmed.size <= 96) break;
      image.remove(); node.remove(); warmed.delete(url);
    }
  };
  let touches = 0;
  const repaint = () => {
    // The filter does not repaint by itself when its images arrive.
    const generation = ++touches;
    for (const delay of [16, 60, 150]) setTimeout(() => { if (touches === generation) filter.setAttribute("x", "0"); }, delay);
  };
  const urls = (maps: MaterialMaps) => [maps.displacement, maps.mask, maps.highlight, maps.outline, ...Object.values(maps.capsule?.planes ?? {}).flat()];
  return {
    warm(maps: MaterialMaps) {
      const fresh = urls(maps).filter((url) => !warmed.has(url));
      if (!fresh.length) return;
      for (const url of fresh) add(url);
      trim();
      repaint();
    },
    /** Whether every image of these maps has been painted here already. */
    has(maps: MaterialMaps) {
      return urls(maps).every((url) => warmed.has(url));
    },
    /** Whether a node is part of the warmer's own markup. */
    owns(node: Node) {
      return svg.contains(node) || probe.contains(node);
    },
    dispose() {
      svg.remove();
      probe.remove();
    },
  };
}
