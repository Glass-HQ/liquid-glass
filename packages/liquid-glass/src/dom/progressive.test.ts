import { expect, test } from "bun:test";
import { PNG } from "pngjs";
import { maskUrl, progressiveGraph, rampTables } from "./progressive.js";
import type { ProgressiveRegion } from "./progressive.js";
import { filterPrimitiveCount } from "./filter-stages.js";

const bottom: ProgressiveRegion = { edge: "bottom", x: 0, y: 300, width: 900, height: 100, blur: 20, refraction: 6 };
const top: ProgressiveRegion = { ...bottom, edge: "top", y: 0 };
const primitives = (markup: string) => new Set([...markup.matchAll(/<(fe\w+)/g)].map((match) => match[1]!));
const boxes = (markup: string, tag: string) => [...markup.matchAll(new RegExp(`<${tag}\\b[^>]*?\\sy="([-\\d.]+)"[^>]*?\\sheight="([-\\d.]+)"`, "g"))]
  .map((match) => ({ y: Number(match[1]), height: Number(match[2]) }));

test("ramp weights split every depth between the blur levels", () => {
  const tables = rampTables.map((table) => table.split(" ").map(Number));
  for (let n = 0; n < tables[0]!.length; n++)
    expect(tables.reduce((sum, table) => sum + table[n]!, 0)).toBeCloseTo(1, 3);
});

test("WebKit band masks split every depth between the blur levels", () => {
  // Each level's image spans only its band; together they cover the depth once.
  const samples = 400;
  const sums = new Float64Array(samples);
  const markup = progressiveGraph("p", [bottom], 900, 400, "webkit");
  for (const match of markup.matchAll(/<feImage data-map="(pg:bottom:\d)"[^>]*?\sy="([-\d.]+)"[^>]*?\sheight="([-\d.]+)"/g)) {
    const png = PNG.sync.read(Buffer.from(maskUrl(match[1]!)!.split(",")[1]!, "base64"));
    const y = Number(match[2]), height = Number(match[3]);
    for (let i = 0; i < samples; i++) {
      const depth = bottom.y + (i + 0.5) * bottom.height / samples;
      if (depth < y || depth >= y + height) continue;
      const row = Math.min(png.height - 1, Math.floor((depth - y) / height * png.height));
      sums[i] += png.data[row * 4 + 3]! / 255;
    }
  }
  // Bands are rounded out to whole pixels, so the boundaries may overlap a little.
  for (let i = 0; i < samples; i++) expect(Math.abs(sums[i]! - 1)).toBeLessThan(0.12);
});

test("Gecko graphs stay on WebRender's native primitives and below its operation limit", () => {
  const markup = progressiveGraph("p", [bottom, top], 900, 400, "gecko");
  for (const unsupported of ["feImage", "feDisplacementMap", "feTile", "feTurbulence"])
    expect(primitives(markup).has(unsupported)).toBe(false);
  expect(filterPrimitiveCount(markup)).toBeLessThanOrEqual(64);
});

test("Chromium needs no images and WebKit needs no ramp blur", () => {
  expect(primitives(progressiveGraph("p", [bottom], 900, 400, "chromium")).has("feImage")).toBe(false);
  const webkit = progressiveGraph("p", [bottom], 900, 400, "webkit");
  expect(webkit).not.toContain("ramp");
  expect(webkit).not.toContain('operator="arithmetic" k2="1" k3="1"/>');
});

test("software engines blur only a band of the region at each level", () => {
  for (const target of ["webkit", "chromium"] as const) {
    const blurs = boxes(progressiveGraph("p", [bottom], 900, 400, target), "feGaussianBlur")
      .filter((box) => box.height < bottom.height);
    expect(blurs.length).toBeGreaterThanOrEqual(6);
    const total = blurs.reduce((sum, box) => sum + box.height, 0);
    // Six full-region blurs would cover six depths; bands cover about two.
    expect(total).toBeLessThan(bottom.height * 2.6);
  }
});
