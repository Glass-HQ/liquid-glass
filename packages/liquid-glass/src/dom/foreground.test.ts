import { expect, test } from "bun:test";
import { foregroundFilter, overlaps, comparePaintOrder } from "./foreground.js";
import type { ForegroundLens } from "./foreground.js";
import type { MaterialMaps } from "./maps.js";

test("foreground optics use local coordinates and preserve transparent input outside the upper lens", () => {
  const target = { x: 100, y: 200, w: 200, h: 100 } as ForegroundLens;
  const overlay = { x: 150, y: 220, w: 80, h: 60, opacity: .5,
    options: { material: "regular", refraction: 8 },
    maps: { mask: "mask.png", displacement: "map.png" } as MaterialMaps,
  } as ForegroundLens;
  const filter = foregroundFilter("test", target, [overlay]);
  expect(filter).toContain('x="0.24" y="0.18"');
  expect(filter).toContain('scale="0.08"');
  expect(filter).toContain('slope="0.5"');
  expect(filter).toContain('in="SourceGraphic" in2="f0mask" operator="out"');
  expect(filter).not.toContain("feTile");
  expect(filter).not.toContain("outline");
  expect(filter).not.toContain("tableValues");
  expect(overlaps(target, overlay)).toBe(true);
  expect(overlaps(target, { x: 300, y: 200, w: 10, h: 10 })).toBe(false);
});

test("upper lenses process the result of preceding foreground passes", () => {
  const target = { x: 0, y: 0, w: 200, h: 100 } as ForegroundLens;
  const overlay = { ...target, opacity: 1, options: { material: "clear" }, maps: { mask: "mask", displacement: "map" } } as ForegroundLens;
  expect(foregroundFilter("test", target, [overlay, overlay])).toContain('<feGaussianBlur in="f0result"');
});

test("paint order respects positioner stacking before DOM order", () => {
  const originalStyle = globalThis.getComputedStyle;
  const originalNode = globalThis.Node;
  const root = { parentElement: null };
  const a = { parentElement: root, style: { position: "absolute", zIndex: "20" }, compareDocumentPosition: () => 4 };
  const b = { parentElement: root, style: { position: "relative", zIndex: "auto" }, compareDocumentPosition: () => 2 };
  try {
    globalThis.Node = { DOCUMENT_POSITION_FOLLOWING: 4 } as typeof Node;
    globalThis.getComputedStyle = ((node: typeof a) => node.style) as unknown as typeof getComputedStyle;
    expect(comparePaintOrder(a as unknown as HTMLElement, b as unknown as HTMLElement)).toBeGreaterThan(0);
    a.style.zIndex = "0";
    expect(comparePaintOrder(a as unknown as HTMLElement, b as unknown as HTMLElement)).toBeLessThan(0);
  } finally {
    globalThis.getComputedStyle = originalStyle;
    globalThis.Node = originalNode;
  }
});
