import { expect, spyOn, test } from "bun:test";
import type { MaterialMaps } from "./maps.js";
import { createMapWarmer, mapWarmup } from "./warm.js";

class ElementStub {
  readonly attributes = new Map<string, string>();
  readonly children: ElementStub[] = [];
  readonly style: Record<string, string> = {};
  parentElement: ElementStub | null = null;
  maximumChildren = 0;
  constructor(readonly ownerDocument: DocumentStub, readonly tagName: string) {}
  get id() { return this.getAttribute("id") ?? ""; }
  set id(value: string) { this.setAttribute("id", value); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
    if (name === "href") this.ownerDocument.imageLinks++;
  }
  append(...elements: ElementStub[]) { for (const element of elements) this.insertBefore(element, null); }
  insertBefore(element: ElementStub, before: ElementStub | null) {
    element.remove();
    this.children.splice(before ? this.children.indexOf(before) : this.children.length, 0, element);
    element.parentElement = this;
    this.maximumChildren = Math.max(this.maximumChildren, this.children.length);
  }
  remove() {
    if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
    this.parentElement = null;
  }
  contains(node: ElementStub): boolean { return this === node || this.children.some((child) => child.contains(node)); }
}
class DocumentStub {
  imageLinks = 0;
  createElement(tag: string) { return new ElementStub(this, tag); }
  createElementNS(_namespace: string, tag: string) { return this.createElement(tag); }
}
/** Eight images: two planes and their capsule slices. */
const maps = (id: number): MaterialMaps => ({
  field: `${id}-field`, overlay: `${id}-overlay`, duration: 0,
  capsule: {
    cap: 10, height: 20,
    planes: {
      field: [`${id}-f-left`, `${id}-f-middle`, `${id}-f-right`],
      overlay: [`${id}-o-left`, `${id}-o-middle`, `${id}-o-right`],
    },
  },
});

function fakeClock() {
  const originalSetTimeout = globalThis.setTimeout, originalClearTimeout = globalThis.clearTimeout;
  const scheduled = new Map<number, { callback: () => void; at: number }>();
  let now = 0, serial = 0;
  const time = spyOn(performance, "now").mockImplementation(() => now);
  globalThis.setTimeout = ((callback: () => void, delay = 0) => {
    const id = ++serial;
    scheduled.set(id, { callback, at: now + delay });
    return id;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((id: number) => { scheduled.delete(id); }) as typeof clearTimeout;
  return {
    scheduled,
    advance(duration: number) {
      const end = now + duration;
      for (;;) {
        const next = [...scheduled].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at;
        scheduled.delete(next[0]);
        next[1].callback();
      }
      now = end;
    },
    restore() {
      time.mockRestore();
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    },
  };
}

test("96 prepared images use separate bounded filter targets, including during eviction", () => {
  const clock = fakeClock();
  const doc = new DocumentStub(), root = doc.createElement("main");
  const warmer = createMapWarmer(root as unknown as HTMLElement);
  const groups = Array.from({ length: 13 }, (_, index) => maps(index));
  try {
    for (let index = 0; index < 12; index++) warmer.warm(groups[index]!);
    clock.advance(mapWarmup);
    const svg = root.children.find((element) => element.tagName === "svg")!;
    const probes = root.children.filter((element) => element.tagName === "div");
    expect(svg.children).toHaveLength(2);
    expect(probes).toHaveLength(2);
    expect(probes.map((probe) => probe.style.filter)).toEqual(svg.children.map((filter) => `url("#${filter.id}")`));
    for (const filter of svg.children) expect(filter.maximumChildren).toBeLessThanOrEqual(49);
    for (let index = 0; index < 12; index++) expect(warmer.has(groups[index]!)).toBe(true);
    const images = () => svg.children.flatMap((filter) => filter.children.filter((child) => child.tagName === "feImage"));
    expect(images()).toHaveLength(96);
    const retained = images();
    warmer.warm(groups[11]!);
    expect(images()).toEqual(retained);
    warmer.warm(groups[12]!);
    expect(images()).toHaveLength(96);
    expect(warmer.has(groups[0]!)).toBe(true);
    expect(warmer.has(groups[1]!)).toBe(true);
    expect(warmer.has(groups[12]!)).toBe(false);
    clock.advance(mapWarmup);
    expect(warmer.has(groups[12]!)).toBe(true);
    expect(svg.children).toHaveLength(2);
    for (const filter of svg.children) expect(filter.maximumChildren).toBeLessThanOrEqual(49);
    for (const element of [svg, ...probes, ...images()]) expect(warmer.owns(element as unknown as Node)).toBe(true);
    expect(warmer.owns(root as unknown as Node)).toBe(false);
  } finally {
    warmer.dispose();
    clock.restore();
  }
  expect(root.children).toHaveLength(0);
});

test("all independent probes repaint after preparation and stop repainting on disposal", () => {
  const clock = fakeClock();
  const doc = new DocumentStub(), root = doc.createElement("main");
  const warmer = createMapWarmer(root as unknown as HTMLElement);
  try {
    for (let index = 0; index < 8; index++) warmer.warm(maps(index));
    const filters = root.children.find((element) => element.tagName === "svg")!.children;
    expect(clock.scheduled.size).toBe(4);
    const callbacks = [...clock.scheduled.values()].map((timer) => timer.callback);
    clock.advance(16);
    expect(filters.map((filter) => filter.getAttribute("x"))).toEqual(["0.000001", "0.000001"]);
    warmer.dispose();
    expect(clock.scheduled.size).toBe(0);
    for (const callback of callbacks) callback();
    expect(filters.map((filter) => filter.getAttribute("x"))).toEqual(["0.000001", "0.000001"]);
    warmer.warm(maps(10));
    expect(root.children).toHaveLength(0);
    expect(warmer.has(maps(10))).toBe(false);
  } finally {
    warmer.dispose();
    clock.restore();
  }
});

test("reentering a path larger than probe capacity retains completed history without bypassing first-use grace", () => {
  const clock = fakeClock();
  const doc = new DocumentStub(), root = doc.createElement("main");
  const warmer = createMapWarmer(root as unknown as HTMLElement);
  const path = Array.from({ length: 20 }, (_, index) => maps(index));
  try {
    for (const maps of path) warmer.warm(maps);
    expect(doc.imageLinks).toBe(160);
    expect(path.some((maps) => warmer.has(maps))).toBe(false);
    clock.advance(mapWarmup - 1);
    warmer.warm(path[19]!);
    expect(warmer.has(path[19]!)).toBe(false);
    expect(doc.imageLinks).toBe(160);
    clock.advance(1);
    // The first64 URLs were evicted before any grace period completed;
    // their preparation must not be mistaken for a successful warm attempt.
    expect(path.map((maps) => warmer.has(maps))).toEqual([...Array(8).fill(false), ...Array(12).fill(true)]);
    for (const maps of path) warmer.warm(maps);
    // Completed maps no longer recirculate through the96 live probe slots.
    expect(doc.imageLinks).toBe(224);
    expect(warmer.has(path[0]!)).toBe(false);
    clock.advance(mapWarmup);
    expect(path.every((maps) => warmer.has(maps))).toBe(true);
    for (const maps of path) warmer.warm(maps);
    expect(doc.imageLinks).toBe(224);
    warmer.dispose();
    expect(path.some((maps) => warmer.has(maps))).toBe(false);
    expect(clock.scheduled.size).toBe(0);
  } finally {
    warmer.dispose();
    clock.restore();
  }
});
