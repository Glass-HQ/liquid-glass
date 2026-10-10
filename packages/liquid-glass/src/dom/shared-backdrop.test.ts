import { expect, test } from "bun:test";
import { sharedBackdropMaterials } from "./shared-backdrop.js";
import type { MaterialOptions } from "../core/materials.js";
import type { FilterBounds } from "./filter-bounds.js";

const consumer = (key: string, x: number, options: MaterialOptions = { material: "regular" }, inputs: string[] = []) => ({
  key, id: key, options, bounds: { x, y: 20, width: 40, height: 30 }, inputs,
});
const attributes = (text: string) => Object.fromEntries([...text.matchAll(/([\w:-]+)="([^"]*)"/g)].map((match) => [match[1]!, match[2]!]));
const primitives = (markup: string) => [...markup.matchAll(/<(fe\w+)\s+([^>]+)\/>/g)].map((match) => ({ tag: match[1], ...attributes(match[2]!) }));
const rect = (p: Record<string, string | undefined>): FilterBounds => ({ x: Number(p.x), y: Number(p.y), width: Number(p.width), height: Number(p.height) });

test("only regular consumers of the unchanged source share a material", () => {
  const members = [
    consumer("a", 10),
    consumer("tinted", 35, { material: "regular", tint: "#123456", refraction: 12 }),
    consumer("dark", 230, { material: "regular", appearance: "dark" }),
    consumer("lower-glass", 10000, { material: "regular" }, ["previousInside"]),
    consumer("clear", 20000, { material: "clear" }),
  ];
  const shared = sharedBackdropMaterials(members, .8);
  expect([...shared.keys()]).toEqual(["a", "tinted", "dark"]);
  expect(shared.get("a")).toBe(shared.get("tinted"));
  expect(shared.get("dark")).not.toBe(shared.get("a"));
  expect(rect(primitives(shared.get("a")!.markup).find((p) => p.tag === "feBlend")!))
    .toEqual({ x: 10, y: 20, width: 65, height: 30 });
  const dark = primitives(shared.get("dark")!.markup);
  expect(dark.find((p) => p.tag === "feBlend")!.mode).toBe("darken");
  expect(dark[0]!.in).toBe("SourceGraphic");
  expect(dark[1]!.in).toBe("SourceGraphic");
  expect(Number(dark[0]!.stdDeviation)).toBeCloseTo(7.33 * .8);
  expect(Number(dark[1]!.stdDeviation)).toBeCloseTo(21.8 * .8);
  expect(Number(dark.at(-1)!.k2)).toBe(.65);
  expect(sharedBackdropMaterials([], 1).size).toBe(0);
});

test("distant consumers keep local work and stable identities while close consumers share", () => {
  const a = consumer("s1", 10), b = consumer("s2", 20), far = consumer("s3", 1000);
  const together = sharedBackdropMaterials([a, b, far], 1);
  const pair = sharedBackdropMaterials([a, b], 1);
  expect(together.get("s1")).toBe(together.get("s2"));
  expect(together.get("s3")).not.toBe(together.get("s1"));
  expect(together.get("s1")!.markup).toBe(pair.get("s1")!.markup);
  expect(together.get("s1")!.result).toBe("sharedLight-s1-s2mix");
  expect(together.get("s3")!.result).toBe("s3mix");
  expect(primitives(together.get("s3")!.markup)).toHaveLength(4);
  expect(sharedBackdropMaterials([b, a], 1).get("s1")!.result).toBe(pair.get("s1")!.result);
  // Toolbar controls and a distant customization button must not make one
  // scene-sized blur merely because their material matches.
  const toolbar = { ...consumer("toolbar", 289.8), bounds: { x: 289.8, y: 284.8, width: 461.5, height: 126.5 } };
  const button = { ...consumer("button", 901.3), bounds: { x: 901.3, y: -35.8, width: 126.5, height: 126.5 } };
  const scattered = sharedBackdropMaterials([toolbar, button], 1);
  expect(scattered.get("toolbar")).not.toBe(scattered.get("button"));
  expect(rect(primitives(scattered.get("toolbar")!.markup)[2]!)).toEqual(toolbar.bounds);
});

test("shared blur has unique ordered dependencies and keeps pointwise work inside consumed bounds", () => {
  const shared = sharedBackdropMaterials([consumer("light", -10), consumer("dark", 100, { material: "regular", appearance: "dark" })], 1);
  const seen = new Set(["SourceGraphic"]);
  for (const [key, material] of shared) {
    const graph = primitives(material.markup), bounds = key === "light" ? { x: -10, y: 20, width: 40, height: 30 } : { x: 100, y: 20, width: 40, height: 30 };
    expect(graph).toHaveLength(4);
    for (const p of graph) {
      expect(seen.has(p.in!)).toBe(true);
      if (p.in2) expect(seen.has(p.in2)).toBe(true);
      expect(seen.has(p.result!)).toBe(false);
      seen.add(p.result!);
    }
    expect(graph.at(-1)!.result).toBe(material.result);
    expect(rect(graph[2]!)).toEqual(bounds);
    expect(rect(graph[3]!)).toEqual(bounds);
    const blur = rect(graph[0]!);
    const fill = rect(graph[1]!);
    expect(fill.x).toBeLessThan(blur.x);
    expect(fill.y).toBeLessThan(blur.y);
    expect(fill.width).toBeGreaterThan(blur.width);
    expect(fill.height).toBeGreaterThan(blur.height);
    expect(blur.x).toBeLessThan(bounds.x);
    expect(blur.y).toBeLessThan(bounds.y);
    expect(blur.x + blur.width).toBeGreaterThan(bounds.x + bounds.width);
    expect(blur.y + blur.height).toBeGreaterThan(bounds.y + bounds.height);
  }
});

test("the narrower frost halo preserves every sampled premultiplied color and alpha pixel", () => {
  const own = consumer("own", 10);
  for (const appearance of ["light", "dark"] as const) for (const soften of [.1, .53, 1]) for (const dpr of [1, 1.5, 2]) for (const alpha of [false, true]) {
    const material = sharedBackdropMaterials([{ ...own, options: { material: "regular", appearance } }], soften).get("own")!;
    const graph = primitives(material.markup), sigma = Number(graph[0]!.stdDeviation);
    const narrow = convolve(rect(graph[0]!), sigma, dpr, alpha);
    // Before separating the halos, frost used the wider fill rectangle.
    const previous = convolve(rect(graph[1]!), sigma, dpr, alpha);
    for (let x = own.bounds.x; x < own.bounds.x + own.bounds.width; x += 1 / dpr) expect(narrow(x)).toBeCloseTo(previous(x), 10);
  }
});

/** Independent finite-kernel reference for WebKit's three box convolutions.
 * Transparent gaps and hard color steps expose output-rectangle edge leaks. */
function convolve(bounds: FilterBounds, sigma: number, dpr: number, alpha: boolean) {
  const left = Math.floor(bounds.x * dpr), right = Math.ceil((bounds.x + bounds.width) * dpr);
  let pixels = Array.from({ length: right - left }, (_, index) => {
    const x = (left + index) / dpr;
    const a = x < -20 || x > 300 || x > 31 && x < 39 ? 0 : 1;
    return alpha ? a : a * (x < 15 ? .05 : x < 37 ? .95 : .2);
  });
  let kernel = Math.min(500, Math.max(2, Math.floor(sigma * dpr * .75 * Math.sqrt(2 * Math.PI) + .5)));
  if (!(kernel % 2)) kernel++;
  const radius = (kernel - 1) / 2;
  for (let pass = 0; pass < 3; pass++) pixels = pixels.map((_, index) => {
    let sum = 0;
    for (let offset = -radius; offset <= radius; offset++) sum += pixels[Math.max(0, Math.min(pixels.length - 1, index + offset))]!;
    return sum / kernel;
  });
  return (x: number) => pixels[Math.floor(x * dpr) - left]!;
}

test("opening a distant consumer cannot alter blur pixels already being sampled", () => {
  const own = consumer("own", 10), distant = consumer("other", 180), nearby = consumer("nearby", 35);
  for (const soften of [.1, .53, 1]) for (const dpr of [1, 1.5, 2]) for (const alpha of [false, true]) {
    const single = primitives(sharedBackdropMaterials([own], soften).get("own")!.markup);
    for (const other of [nearby, distant]) for (const index of [0, 1]) {
      const joined = primitives(sharedBackdropMaterials([own, other], soften).get("own")!.markup);
      const sigma = Number(single[index]!.stdDeviation);
      const a = convolve(rect(single[index]!), sigma, dpr, alpha);
      const b = convolve(rect(joined[index]!), sigma, dpr, alpha);
      for (let x = own.bounds.x; x < own.bounds.x + own.bounds.width; x += 1 / dpr) expect(a(x)).toBeCloseTo(b(x), 10);
    }
  }
  // The reference detects the regression if the Gaussian loses its halo.
  const tight = convolve(own.bounds, 23, 1, false);
  const full = convolve({ ...own.bounds, x: -61, width: 182 }, 23, 1, false);
  expect(Math.abs(tight(11) - full(11))).toBeGreaterThan(.01);
});
