import { chromium } from "./engine.js";
import { pageZoom, zoomFilterMarkup } from "./page-zoom.js";

/** A filter is library-generated SVG: elements and double-quoted attributes,
 * without text nodes. Keep its description outside the DOM so animation
 * frames never construct a second, disposable SVG tree just to compare it. */
interface Description {
  tag: string;
  attributes: Record<string, string>;
  children: Description[];
}
interface Retained {
  element: Element;
  description: Description;
  children: Map<string, Retained>;
}
interface Filter extends Retained { markup: string; id: string }
const scenes = new WeakMap<Element, Map<string, Filter>>();
const ns = "http://www.w3.org/2000/svg";
let version = 0;

/** Retain filter primitives and their loaded images across geometry changes.
 * The last description also owns the attribute values, avoiding live DOM
 * collection reads and redundant writes. Exact repeats do no parsing at all. */
export function patchFilters(defs: Element, markup: readonly string[], resolve: (token: string) => string | undefined): (id: string) => string {
  let live = scenes.get(defs);
  if (!live) { live = new Map(); scenes.set(defs, live); }
  const remaining = new Set(live.keys());
  const ids = new Map<string, string>();
  const links: Element[] = [];
  const zoom = pageZoom();
  for (const original of markup) {
    const source = zoomFilterMarkup(original, zoom);
    const base = /\bid="([^"]+)"/.exec(source)?.[1];
    if (!base) throw new Error("A glass filter must have an id.");
    remaining.delete(base);
    let current = live.get(base);
    if (current?.element.parentElement !== defs) current = undefined;
    if (current?.markup === source) { ids.set(base, current.id); continue; }
    const description = describe(source);
    if (current) {
      const structural = reconcile(current, description, links);
      current.markup = source;
      // Chromium does not always repaint after graph structure changes.
      if (structural && chromium) current.element.setAttribute("x", description.attributes.x!);
    } else {
      const id = `${base}-${++version}`;
      const retained = create(defs.ownerDocument, description, links);
      retained.element.setAttribute("data-filter", base);
      retained.element.id = id;
      defs.append(retained.element);
      current = { ...retained, markup: source, id };
      live.set(base, current);
    }
    ids.set(base, current.id);
  }
  for (const base of remaining) { live.get(base)!.element.remove(); live.delete(base); }
  let linked = false;
  // Images are linked only after the whole graph is connected. A detached
  // feImage does not repaint its filter when its image arrives.
  for (const element of links) {
    const url = resolve(element.getAttribute("data-map")!);
    if (!url || element.getAttribute("href") === url) continue;
    element.setAttribute("href", url);
    linked = true;
  }
  // One settling sequence per graph update, not one for every map image.
  if (linked && chromium) settle(defs);
  return (id) => ids.get(id) ?? id;
}

/** Parse only the generated subset; attributes never contain markup or
 * character references. Keeping this private avoids turning it into a
 * general SVG parser or accepting arbitrary user markup. */
function describe(markup: string): Description {
  const stack: Description[] = [];
  let root: Description | undefined;
  const tags = /<(\/?)([\w:-]+)([^>]*?)(\/?)>/g;
  for (const match of markup.matchAll(tags)) {
    const [, closing, tag, source, selfClosing] = match;
    if (closing) {
      if (stack.pop()?.tag !== tag) throw new Error("Unbalanced glass filter markup.");
      continue;
    }
    const attributes: Record<string, string> = {};
    for (const [, name, value] of source!.matchAll(/([\w:-]+)="([^"]*)"/g)) attributes[name!] = value!;
    const node: Description = { tag: tag!, attributes, children: [] };
    if (stack.length) stack[stack.length - 1]!.children.push(node);
    else if (root) throw new Error("Expected one glass filter.");
    else root = node;
    if (!selfClosing) stack.push(node);
  }
  if (!root || stack.length || root.tag !== "filter") throw new Error("Invalid glass filter markup.");
  // Result names are retained-node identities. Reusing one would leave
  // untracked DOM nodes behind and could change the filter's final output.
  const results = new Set<string>();
  for (const child of root.children) {
    const result = child.attributes.result;
    if (!result) continue;
    if (results.has(result)) throw new Error(`Duplicate glass filter result "${result}".`);
    results.add(result);
  }
  // Image definitions have no inputs. Keeping them in a stable leading
  // block avoids detaching loaded images when optical branches regroup.
  // An omitted input means the previous primitive, so those graphs must
  // retain their order, as must a graph whose final output is an image.
  const explicitInputs = root.children.every((child) => {
    if (["feImage", "feFlood", "feTurbulence"].includes(child.tag)) return true;
    if (child.tag === "feMerge") return child.children.every((input) => Boolean(input.attributes.in));
    return Boolean(child.attributes.in) &&
      (!["feBlend", "feComposite", "feDisplacementMap"].includes(child.tag) || Boolean(child.attributes.in2));
  });
  if (explicitInputs && root.children.at(-1)?.tag !== "feImage") {
    const images = root.children.filter((child) => child.tag === "feImage");
    images.sort((a, b) => (a.attributes.result ?? "") < (b.attributes.result ?? "") ? -1 : (a.attributes.result ?? "") > (b.attributes.result ?? "") ? 1 : 0);
    root.children = [...images, ...root.children.filter((child) => child.tag !== "feImage")];
  }
  return root;
}
const key = (description: Description, index: number) => description.attributes.result ?? `${description.tag}#${index}`;
function create(document: Document, description: Description, links: Element[]): Retained {
  const element = document.createElementNS(ns, description.tag);
  for (const [name, value] of Object.entries(description.attributes)) element.setAttribute(name, value);
  const children = new Map<string, Retained>();
  description.children.forEach((child, index) => {
    const retained = create(document, child, links);
    children.set(key(child, index), retained);
    element.append(retained.element);
  });
  if (description.attributes["data-map"]) links.push(element);
  return { element, description, children };
}
/** Reconcile by result name at every level, so changing merge inputs does
 * not replace the merge or any neighboring feImage resource. */
function reconcile(live: Retained, next: Description, links: Element[]): boolean {
  const previous = live.description.attributes;
  for (const [name, value] of Object.entries(next.attributes)) {
    if (name === "id" || previous[name] === value) continue;
    live.element.setAttribute(name, value);
    if (name === "data-map") links.push(live.element);
  }
  for (const name of Object.keys(previous)) if (name !== "id" && !(name in next.attributes)) live.element.removeAttribute(name);
  const remaining = new Map(live.children);
  const children = new Map<string, Retained>();
  let structural = false;
  // A stale insertion cursor would move every surviving sibling past it.
  // Remove unused and tag-replaced nodes before ordering the survivors.
  const wanted = new Map(next.children.map((description, index) => [key(description, index), description.tag]));
  for (const [name, child] of remaining) if (wanted.get(name) !== child.description.tag) {
    child.element.remove(); remaining.delete(name); structural = true;
  }
  let cursor = live.element.firstElementChild;
  next.children.forEach((description, index) => {
    const name = key(description, index);
    let child = remaining.get(name);
    if (child?.description.tag === description.tag) {
      remaining.delete(name);
      structural = reconcile(child, description, links) || structural;
    } else {
      child = create(live.element.ownerDocument, description, links);
      structural = true;
    }
    if (child.element !== cursor) { live.element.insertBefore(child.element, cursor); structural = true; }
    cursor = child.element.nextElementSibling;
    children.set(name, child);
  });
  for (const child of remaining.values()) { child.element.remove(); structural = true; }
  live.description = next;
  live.children = children;
  return structural;
}

const settling = new WeakMap<Element, number>();
/** Chromium does not repaint a filtered element when an feImage becomes
 * ready by itself. Re-evaluate with growing gaps until the prepared image
 * has reached the filter renderer, without restarting it every frame. */
function settle(defs: Element) {
  const generation = (settling.get(defs) ?? 0) + 1;
  settling.set(defs, generation);
  for (const delay of [16, 100, 300, 700, 1500, 3000]) setTimeout(() => {
    if (settling.get(defs) !== generation || !defs.isConnected) return;
    const image = defs.querySelector("feImage");
    image?.setAttribute("x", image.getAttribute("x")!);
  }, delay);
}
