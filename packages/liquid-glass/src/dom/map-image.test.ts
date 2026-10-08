import { expect, test } from "bun:test";
import { capsuleMapGeometry, mapImage, mapUrl } from "./map-image.js";
import type { MaterialMaps } from "./maps.js";

test("wide capsules share one GPU geometry across animated widths", () => {
  const geometry = { width: 75, height: 30, radius: "capsule" as const, dpr: 2 };
  expect(capsuleMapGeometry(geometry)).toEqual(capsuleMapGeometry({ ...geometry, width: 118 }));
  expect(capsuleMapGeometry({ ...geometry, width: 55 })).toBeUndefined();
  expect(capsuleMapGeometry({ ...geometry, radius: 12 })).toBeUndefined();
  expect(capsuleMapGeometry({ ...geometry, outline: [[0, 0], [75, 0], [0, 30]] })).toBeUndefined();
});

/** Image placements by result name, with tokens read back as URLs. */
function images(markup: string) {
  const result = new Map<string, { url: string; x: number; y: number; width: number; height: number }>();
  for (const [, attributes] of markup.matchAll(/<feImage ([^>]*)\/>/g)) {
    const read = (name: string) => Number(new RegExp(`\\b${name}="([-\\d.]+)"`).exec(attributes!)?.[1]);
    const name = /result="([^"]+)"/.exec(attributes!)![1]!;
    const url = mapUrl(/data-map="([^"]+)"/.exec(attributes!)![1]!)!;
    result.set(name, { url, x: read("x"), y: read("y"), width: read("width"), height: read("height") });
  }
  return result;
}
const planes = { mask: ["left", "middle", "right"] } as Record<"mask", [string, string, string]>;
const maps = { mask: "full", capsule: { cap: 32, height: 34, planes } } as unknown as MaterialMaps;

test("animated capsule keeps both cap widths and moves the right cap with its edge", () => {
  for (const width of [79, 100, 122]) {
    const b = images(mapImage(maps, "mask", "mask", 10, 20, width, 34));
    expect(b.get("maskL")).toEqual({ url: "left", x: 10, y: 20, width: 32, height: 34 });
    // The uniform middle tucks half a pixel under each cap to avoid seams.
    expect(b.get("maskM")).toEqual({ url: "middle", x: 41.5, y: 20, width: width - 63, height: 34 });
    expect(b.get("maskR")).toEqual({ url: "right", x: 10 + width - 32, y: 20, width: 32, height: 34 });
  }
  expect(images(mapImage(maps, "mask", "mask", 0, 0, 50, 34)).get("mask")?.url).toBe("full");
});

test("a pressed capsule scales its caps with its height so its ends stay round", () => {
  const b = images(mapImage(maps, "mask", "mask", 0, 0, 200, 51));
  expect(b.get("maskL")!.width).toBeCloseTo(48);
  expect(b.get("maskR")!.x).toBeCloseTo(152);
});
