/** Keep SVG filters as retained elements. Each frame's markup is parsed into
 * an inert template and compared with the live filters: matching filters only
 * have changed attributes written, so image primitives keep their loaded
 * images and filter references stay valid. Rebuilding filter markup instead
 * makes every image reload asynchronously, which shows as the material
 * blinking for a frame whenever a surface animates. Image primitives name
 * their map with a short `data-map` token, resolved to its URL only when the
 * map changes. */
export function patchFilters(defs: Element, markup: readonly string[], resolve: (token: string) => string | undefined): (id: string) => string {
  const template = defs.ownerDocument.createElement("template");
  // Template content is inert: parsing never fetches or decodes images.
  template.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">${markup.join("")}</svg>`;
  const next = [...template.content.firstElementChild!.children];
  const live = new Map<string, Element>();
  for (const filter of [...defs.children]) live.set(filter.getAttribute("data-filter")!, filter);
  const ids = new Map<string, string>();
  for (const filter of next) {
    const base = filter.id;
    const current = live.get(base);
    live.delete(base);
    if (current) {
      reconcile(current, filter, resolve);
      ids.set(base, current.id);
      continue;
    }
    // A reference to a removed element is not rebound, so a new filter takes
    // a fresh id; the changed reference string makes it resolve.
    const created = defs.ownerDocument.importNode(filter, true);
    created.setAttribute("data-filter", base);
    created.id = `${base}-${++version}`;
    defs.append(created);
    // Link images once connected: a detached feImage does not repaint its
    // filter when its image arrives.
    for (const image of created.querySelectorAll("[data-map]")) link(image, resolve);
    ids.set(base, created.id);
  }
  for (const filter of live.values()) filter.remove();
  return (id) => ids.get(id) ?? id;
}
let version = 0;
/** Bring a live filter to the next markup while keeping every primitive that
 * still exists, keyed by its result name. Surfaces entering or leaving the
 * scene then never reload the images of the others. */
function reconcile(live: Element, next: Element, resolve: (token: string) => string | undefined) {
  for (const { name, value } of next.attributes) if (name !== "id" && live.getAttribute(name) !== value) live.setAttribute(name, value);
  const key = (element: Element, index: number) => element.getAttribute("result") ?? `${element.tagName}#${index}`;
  const existing = new Map<string, Element>();
  [...live.children].forEach((child, index) => existing.set(key(child, index), child));
  let changed = false;
  const created: Element[] = [];
  const order = [...next.children].map((child, index) => {
    const match = existing.get(key(child, index));
    if (match && sameStructure(match, child)) {
      existing.delete(key(child, index));
      patch(match, child, resolve);
      return match;
    }
    changed = true;
    const node = live.ownerDocument.importNode(child, true);
    created.push(node);
    return node;
  });
  order.forEach((node, index) => {
    if (live.children[index] !== node) { live.insertBefore(node, live.children[index] ?? null); changed = true; }
  });
  for (const stale of existing.values()) { stale.remove(); changed = true; }
  for (const node of created) for (const image of [node, ...node.querySelectorAll("*")]) if (image.hasAttribute("data-map")) link(image, resolve);
  // Changing a referenced filter's children does not repaint by itself.
  if (changed) live.setAttribute("x", live.getAttribute("x")!);
}
function sameStructure(a: Element, b: Element): boolean {
  if (a.tagName !== b.tagName || a.children.length !== b.children.length) return false;
  for (let i = 0; i < a.children.length; i++) if (!sameStructure(a.children[i]!, b.children[i]!)) return false;
  return true;
}
/** Point an image primitive at the map its token names. */
function link(image: Element, resolve: (token: string) => string | undefined) {
  const url = resolve(image.getAttribute("data-map")!);
  if (!url || image.getAttribute("href") === url) return;
  image.setAttribute("href", url);
  const defs = image.closest("defs");
  if (defs) settle(defs);
}
const settling = new WeakMap<Element, number>();
/** Chromium does not repaint a filtered element when an `feImage` image
 * becomes ready by itself, and offers no load event to wait for. Writing one
 * unchanged attribute invalidates the filter. Repeating that every frame
 * keeps restarting the image's preparation, so it is repeated a few times
 * with growing gaps: the first repaint that finds the image ready shows it. */
function settle(defs: Element) {
  const generation = (settling.get(defs) ?? 0) + 1;
  settling.set(defs, generation);
  for (const delay of [16, 100, 300, 700, 1500, 3000]) setTimeout(() => {
    if (settling.get(defs) !== generation || !defs.isConnected) return;
    const image = defs.querySelector("feImage");
    image?.setAttribute("x", image.getAttribute("x")!);
  }, delay);
}
function patch(live: Element, next: Element, resolve: (token: string) => string | undefined): void {
  let relink = false;
  for (const { name, value } of next.attributes) if (live.getAttribute(name) !== value) {
    live.setAttribute(name, value);
    relink ||= name === "data-map";
  }
  // The resolved href and the live id are owned by the patcher, not the markup.
  for (const { name } of [...live.attributes]) if (name !== "href" && !next.hasAttribute(name)) live.removeAttribute(name);
  if (relink) link(live, resolve);
  for (let i = 0; i < next.children.length; i++) patch(live.children[i]!, next.children[i]!, resolve);
}
