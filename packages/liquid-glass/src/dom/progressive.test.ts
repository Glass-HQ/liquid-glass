import { expect, test } from "bun:test";
import { PNG } from "pngjs";
import { coverTables, maskUrl, progressiveGraph, rampTables } from "./progressive.js";
import type { ProgressiveRegion } from "./progressive.js";
import { filterPrimitiveCount } from "./filter-stages.js";

const bottom: ProgressiveRegion = { edge: "bottom", x: 0, y: 300, width: 900, height: 100, blur: 20, refraction: 6 };
const top: ProgressiveRegion = { ...bottom, edge: "top", y: 0 };
const primitives = (markup: string) => new Set([...markup.matchAll(/<(fe\w+)/g)].map((match) => match[1]!));
const boxes = (markup: string, tag: string) => [...markup.matchAll(new RegExp(`<${tag}\\b[^>]*?\\sy="([-\\d.]+)"[^>]*?\\sheight="([-\\d.]+)"`, "g"))]
  .map((match) => ({ y: Number(match[1]), height: Number(match[2]) }));

/** What each level contributes: its cover less the sharper level's. */
const shares = (covers: number[]) => covers.map((cover, level) => cover * (1 - (level ? covers[level - 1]! : 0)));

test("ramp weights split every depth between the blur levels", () => {
  for (const tables of [rampTables, coverTables.map((table, level) => level === coverTables.length - 1 ? table.replace(/[\d.]+/g, "1") : table)]) {
    const rows = tables.map((table) => table.split(" ").map(Number));
    for (let n = 0; n < rows[0]!.length; n++) {
      const split = tables === rampTables ? rows.map((row) => row[n]!) : shares(rows.map((row) => row[n]!));
      expect(split.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1, 3);
    }
  }
});

test("WebKit band masks split every depth between the blur levels", () => {
  // Each level's image spans only its band; together they cover the depth once.
  const samples = 400;
  const markup = progressiveGraph("p", [bottom], 900, 400, "webkit");
  // Where each level is drawn, and its cover image; outside an image the cover is transparent.
  const images = [...markup.matchAll(/<feImage data-map="(pg:bottom:(\d))"[^>]*?\sy="([-\d.]+)"[^>]*?\sheight="([-\d.]+)"/g)].map((m) => ({ level: Number(m[2]), y: Number(m[3]), height: Number(m[4]), png: PNG.sync.read(Buffer.from(maskUrl(m[1]!)!.split(",")[1]!, "base64")) }));
  const cover = (level: number, depth: number) => {
    const image = images.find((i) => i.level === level);
    if (!image || depth < image.y || depth >= image.y + image.height) return 0;
    return image.png.data[Math.min(image.png.height - 1, Math.floor((depth - image.y) / image.height * image.png.height)) * 4 + 3]! / 255;
  };
  const parts = [...markup.matchAll(/<feComposite[^>]*?\sy="([-\d.]+)"[^>]*?\sheight="([-\d.]+)"[^>]*?result="e0part(\d)"/g)].map((m) => ({ level: Number(m[3]), y: Number(m[1]), height: Number(m[2]) }));
  expect(parts.length).toBe(7);
  for (let i = 0; i < samples; i++) {
    const depth = bottom.y + (i + 0.5) * bottom.height / samples;
    let sum = 0;
    for (const { level, y, height } of parts) {
      if (depth < y || depth >= y + height) continue;
      sum += (level === 6 ? 1 : cover(level, depth)) * (1 - (level ? cover(level - 1, depth) : 0));
    }
    // Bands are rounded out to whole pixels, so their ends may be cut a little.
    expect(Math.abs(sum - 1)).toBeLessThan(0.12);
  }
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
