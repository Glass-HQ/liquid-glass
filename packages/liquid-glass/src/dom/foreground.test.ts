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
  expect(filter).toContain('x="48" y="18"');
  expect(filter).toContain('scale="16"');
  expect(filter).toContain('primitiveUnits="userSpaceOnUse"');
  expect(filter).toContain('slope="0.5"');
  expect(filter).toContain('in="SourceGraphic" in2="f0mask" operator="out"');
  expect(filter).not.toContain("feTile");
  expect(filter).not.toContain("outline");
  expect(filter).not.toContain("tableValues");
  expect(filter).not.toContain("feFlood");
  // Refraction is restricted to the map; blur retains the full 3-sigma
  // sampling neighborhood plus the largest possible displacement.
  expect(filter).toContain('in2="f0map" x="48" y="18" width="84" height="64"');
  const blur = /<feGaussianBlur[^>]+>/.exec(filter)![0];
  expect(blur).toContain('width="');
  expect(overlaps(target, overlay)).toBe(true);
  expect(overlaps(target, { x: 300, y: 200, w: 10, h: 10 })).toBe(false);
});

test("foreground refraction keeps the same pixel displacement across target aspect ratios", () => {
  const overlay = { x: 50, y: 20, w: 80, h: 60, opacity: 1,
    options: { material: "clear", refraction: 8 },
    maps: { mask: "mask.png", displacement: "map.png" } as MaterialMaps,
  } as ForegroundLens;
  for (const [w, h] of [[200, 100], [100, 200], [400, 50]]) {
    const target = { x: 0, y: 0, w, h } as ForegroundLens;
    const markup = foregroundFilter("test", target, [overlay]);
    expect(markup).toContain('x="48" y="18" width="84" height="64"');
    expect(markup).toContain('scale="16"');
    expect(markup).toContain('primitiveUnits="userSpaceOnUse"');
  }
});

test("upper lenses process the result of preceding foreground passes", () => {
  const target = { x: 0, y: 0, w: 200, h: 100 } as ForegroundLens;
  const overlay = { ...target, opacity: 1, options: { material: "clear" }, maps: { mask: "mask", displacement: "map" } } as ForegroundLens;
  const filter = foregroundFilter("test", target, [overlay, overlay]);
  expect(filter).toContain('<feDisplacementMap in="f0result"');
  expect(filter).not.toContain("feGaussianBlur");
  expect(filter).not.toContain("feComponentTransfer");
});

test("scaled foreground targets keep the glass in the same viewport location", () => {
  const target = { x: 0, y: 0, w: 200, h: 100, element: { offsetWidth: 100, offsetHeight: 50 } } as ForegroundLens;
  const overlay = { x: 50, y: 20, w: 80, h: 60, opacity: 1,
    options: { material: "regular", refraction: 8 },
    maps: { mask: "mask.png", displacement: "map.png" } as MaterialMaps,
  } as ForegroundLens;
  const markup = foregroundFilter("scaled", target, [overlay]);
  expect(markup).toContain('x="24" y="9" width="42" height="32"');
  expect(markup).toContain('scale="8"');
  expect(markup).toContain('stdDeviation="3.665 3.665"');
  expect(markup).not.toContain('result="f0rawmap"');
});

test("unequal target scales preserve displacement on each viewport axis without clipping channels", () => {
  const target = { x: 0, y: 0, w: 200, h: 50, element: { offsetWidth: 100, offsetHeight: 100 } } as ForegroundLens;
  const overlay = { x: 50, y: 20, w: 80, h: 60, opacity: 1,
    options: { material: "regular", refraction: 8 },
    maps: { mask: "mask.png", displacement: "map.png" } as MaterialMaps,
  } as ForegroundLens;
  const markup = foregroundFilter("stretched", target, [overlay]);
  expect(markup).toContain('x="24" y="36" width="42" height="128"');
  expect(markup).toContain('stdDeviation="3.665 14.66"');
  const scale = Number(/<feDisplacementMap[^>]* scale="([^"]+)"/.exec(markup)![1]);
  for (const [channel, cssScale] of [["R", 2], ["G", 0.5]] as const) {
    const transfer = new RegExp(`<feFunc${channel} type="linear" slope="([^"]+)" intercept="([^"]+)"`).exec(markup)!;
    const slope = Number(transfer[1]), intercept = Number(transfer[2]);
    for (const value of [0, 0.25, 0.5, 0.75, 1]) {
      const mapped = value * slope + intercept;
      expect(mapped).toBeGreaterThanOrEqual(0);
      expect(mapped).toBeLessThanOrEqual(1);
      expect(scale * (mapped - 0.5) * cssScale).toBeCloseTo(16 * (value - 0.5), 8);
    }
  }
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
