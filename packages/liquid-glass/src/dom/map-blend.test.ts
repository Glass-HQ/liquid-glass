import { expect, test } from "bun:test";
import { blendMapImage } from "./map-blend.js";
import type { PlacedMap } from "./map-blend.js";
import { mapImage } from "./map-image.js";
import type { MapPlane } from "./map-image.js";
import type { MaterialMaps } from "./maps.js";
import { filterPrimitiveCount } from "./filter-stages.js";

const planes: MapPlane[] = ["displacement", "mask", "highlight", "outline"];
const maps: MaterialMaps = { displacement: "map", mask: "mask", highlight: "light", outline: "rim", duration: 0 };
const a: PlacedMap = { maps, x: 10.25, y: -5.75, w: 140, h: 30 };

test("identical placements emit the original map pixels and remove two operations per plane", () => {
  for (const b of [a, { ...a }]) for (const mix of [0, 0.2, 0.5, 1]) for (const plane of planes) {
    const result = blendMapImage(plane, "image", { a, b, mix }, a, true);
    expect(result).toBe(mapImage(maps, plane, "image", a.x - 2, a.y - 2, a.w + 4, a.h + 4));
    expect(filterPrimitiveCount(result)).toBe(1);
    expect(filterPrimitiveCount(blendMapImage(plane, "image", { a, b, mix }, a))).toBe(3);
  }
});

test("distinct map resources or any changed coordinate retain both inputs even at zero or full blend", () => {
  const distinct = [
    { ...a, maps: { ...maps, mask: "other-mask" } },
    ...(["x", "y", "w", "h"] as const).map((key) => ({ ...a, [key]: a[key] + 0.0001 })),
  ];
  for (const b of distinct) for (const mix of [0, 0.5, 1]) {
    const result = blendMapImage("mask", "mask", { a, b, mix }, a, true);
    expect(filterPrimitiveCount(result)).toBe(3);
    expect(result).toContain('in="maskA" in2="maskB"');
    expect(result).toContain(`k2="${(1 - mix).toFixed(4)}" k3="${mix.toFixed(4)}"`);
    expect(result).toContain('x="8.25" y="-7.75" width="144" height="34"');
  }
});

test("a repeated sliced capsule saves twenty operations across its four planes without changing cap placement", () => {
  const capsule: MaterialMaps = { ...maps, capsule: { cap: 32, height: 34,
    planes: Object.fromEntries(planes.map((plane) => [plane, [`${plane}-left`, `${plane}-middle`, `${plane}-right`]])) as Record<MapPlane, [string, string, string]>,
  } };
  const p = { ...a, maps: capsule };
  let before = 0, after = 0;
  for (const plane of planes) {
    const result = blendMapImage(plane, plane, { a: p, b: p, mix: 0 }, p, true);
    expect(result).toBe(mapImage(capsule, plane, plane, p.x - 2, p.y - 2, p.w + 4, p.h + 4));
    before += filterPrimitiveCount(blendMapImage(plane, plane, { a: p, b: p, mix: 0 }, p));
    after += filterPrimitiveCount(result);
  }
  expect(before).toBe(36);
  expect(after).toBe(16);
});
