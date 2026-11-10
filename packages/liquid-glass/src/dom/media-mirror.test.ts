import { expect, test } from "bun:test";
import { mirrorable } from "./composited.js";
import { holeClip, objectBox } from "./media-mirror.js";

test("replaced content lands where object-fit and object-position put it", () => {
  const box = { x: 0, y: 0, w: 400, h: 200 };
  const video = { width: 1600, height: 1200 };
  expect(objectBox(box, video, "fill", "50% 50%")).toEqual(box);
  const contained = objectBox(box, video, "contain", "50% 50%");
  expect([contained.x, contained.y, contained.w, contained.h].map((n) => Math.round(n * 1000) / 1000)).toEqual([66.667, 0, 266.667, 200]);
  expect(objectBox(box, video, "cover", "50% 50%")).toEqual({ x: 0, y: -50, w: 400, h: 300 });
  expect(objectBox(box, video, "cover", "0% 0%")).toEqual({ x: 0, y: 0, w: 400, h: 300 });
  expect(objectBox(box, { width: 100, height: 50 }, "none", "10px 20px")).toEqual({ x: 10, y: 20, w: 100, h: 50 });
  expect(objectBox(box, { width: 100, height: 50 }, "scale-down", "50% 50%")).toEqual({ x: 150, y: 75, w: 100, h: 50 });
});

test("holes cut rounded lenses out of the whole box", () => {
  const clip = holeClip(300, 200, [{ x: 10, y: 20, w: 100, h: 40, radius: 30 }, { x: 150, y: 50, w: 20, h: 20, radius: 0 }]);
  expect(clip.startsWith('path(evenodd, "M0 0H300V200H0Z')).toBe(true);
  // A capsule radius never exceeds half the lens height.
  expect(clip).toContain("M30 20H90A20 20 0 0 1 110 40");
  expect(clip).toContain("M150 50H170V70H150Z");
});

test("only drawable media mirror", () => {
  expect(mirrorable({ localName: "video" } as Element)).toBe(true);
  expect(mirrorable({ localName: "video", mediaKeys: {} } as unknown as Element)).toBe(false);
  expect(mirrorable({ localName: "canvas", width: 0, height: 10 } as unknown as Element)).toBe(false);
  expect(mirrorable({ localName: "canvas", width: 10, height: 10 } as unknown as Element)).toBe(true);
  expect(mirrorable({ localName: "img" } as Element)).toBe(false);
});
