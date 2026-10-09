import { expect, spyOn, test } from "bun:test";
import { createProgressiveLayer } from "./progressive.js";
import * as progressiveMaps from "./progressive-maps.js";
import type { ProgressiveMaps } from "./progressive-maps.js";

function deferred() {
  return Promise.withResolvers<ProgressiveMaps>();
}
const maps: ProgressiveMaps = { weights: Array(7).fill("data:image/png;base64,mask"), displacement: "data:image/png;base64,map" };

function environment() {
  class Rect {
    constructor(public x: number, public y: number, public width: number, public height: number) {}
    get left() { return this.x; }
    get right() { return this.x + this.width; }
    get top() { return this.y; }
    get bottom() { return this.y + this.height; }
  }
  const doc = {
    body: { append() {} },
    createElementNS: () => ({
      style: {}, innerHTML: "", setAttribute() {}, replaceChildren() {}, remove() {}, querySelectorAll: () => [],
    }),
  };
  const globals = {
    document: doc,
    matchMedia: () => ({ matches: false }),
    getComputedStyle: () => ({ direction: "ltr", overflow: "visible" }),
    innerWidth: 1000,
    innerHeight: 1000,
    DOMRect: Rect,
  };
  const previous = Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const root = { ownerDocument: doc, dataset: {} } as unknown as HTMLElement;
  const content = {
    parentElement: null,
    style: { filter: "" },
    offsetWidth: 300, offsetHeight: 200,
    clientWidth: 300, clientHeight: 200, clientLeft: 0, clientTop: 0,
    scrollWidth: 300, scrollHeight: 600, scrollLeft: 0, scrollTop: 0,
    getBoundingClientRect: () => new Rect(0, 0, 300, 200),
  } as unknown as HTMLElement;
  const region = { getBoundingClientRect: () => new Rect(0, 120, 300, 80) } as unknown as HTMLElement;
  return {
    root, content, region,
    restore: () => {
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}

test("cold progressive maps wake an idle scene, including scroll viewport layers", async () => {
  for (const scroll of [false, true]) {
    const dom = environment();
    const request = deferred();
    const load = spyOn(progressiveMaps, "getProgressiveMaps").mockReturnValue(request.promise);
    let wakes = 0;
    let effect = "";
    const layer = createProgressiveLayer(dom.root, (error) => { throw error; }, false, () => {
      wakes++;
      // Model the scene's next frame: no scroll or other DOM event wakes it.
      effect = layer.update(dom.content);
    });
    try {
      if (scroll) layer.addScroll({ target: dom.content, edges: ["bottom"] });
      else layer.add(dom.region);
      effect = layer.update(dom.content);
      expect(effect).toBe("");
      expect(dom.content.style.filter).toBe("");
      expect(load).toHaveBeenCalledTimes(1);
      request.resolve(maps);
      await request.promise;
      expect(wakes).toBe(1);
      expect(effect).toMatch(/^url\("#lg-progressive-/);
      expect(load).toHaveBeenCalledTimes(1);
    } finally {
      layer.dispose();
      load.mockRestore();
      dom.restore();
    }
  }
});

test("failed map requests wake diagnostics and an explicit update can retry", async () => {
  const dom = environment();
  const first = deferred(), retry = deferred();
  const load = spyOn(progressiveMaps, "getProgressiveMaps").mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise);
  const errors: Error[] = [];
  let wakes = 0;
  const layer = createProgressiveLayer(dom.root, (error) => errors.push(error), false, () => { wakes++; });
  try {
    const remove = layer.add(dom.region);
    layer.update(dom.content);
    first.reject("GPU unavailable");
    await first.promise.catch(() => {});
    await Promise.resolve();
    expect(errors.map((error) => error.message)).toEqual(["GPU unavailable"]);
    expect(wakes).toBe(1);
    layer.update(dom.content);
    expect(load).toHaveBeenCalledTimes(1);
    remove();
    layer.add(dom.region);
    layer.update(dom.content);
    expect(load).toHaveBeenCalledTimes(2);
    retry.resolve(maps);
    await retry.promise;
    expect(wakes).toBe(2);
    expect(layer.update(dom.content)).toMatch(/^url\("#lg-progressive-/);
  } finally {
    layer.dispose();
    load.mockRestore();
    dom.restore();
  }
});

test("disposed scroll layers ignore late map success and failure", async () => {
  for (const rejected of [false, true]) {
    const dom = environment();
    const request = deferred();
    const load = spyOn(progressiveMaps, "getProgressiveMaps").mockReturnValue(request.promise);
    const errors: Error[] = [];
    let wakes = 0;
    const layer = createProgressiveLayer(dom.root, (error) => errors.push(error), false, () => { wakes++; });
    try {
      layer.addScroll({ target: dom.content, edges: ["bottom"] });
      layer.update(dom.content);
      expect(load).toHaveBeenCalledTimes(1);
      layer.dispose();
      if (rejected) request.reject(new Error("Late GPU error"));
      else request.resolve(maps);
      await request.promise.catch(() => {});
      await Promise.resolve();
      expect(wakes).toBe(0);
      expect(errors).toEqual([]);
      expect(dom.content.style.filter).toBe("");
    } finally {
      layer.dispose();
      load.mockRestore();
      dom.restore();
    }
  }
});
