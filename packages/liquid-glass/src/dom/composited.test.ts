import { expect, test } from "bun:test";
import { animatesInCompositor, animatesPaint, compositingReason, createsLayer, has3DTransform, overlapComposited } from "./composited.js";
import type { CompositingStyle } from "./composited.js";

const style = (overrides: Partial<CompositingStyle> = {}): CompositingStyle => ({
  transform: "none", translate: "none", rotate: "none", scale: "none", willChange: "auto", position: "static", backfaceVisibility: "visible",
  overflowX: "visible", overflowY: "visible", zIndex: "auto", opacity: "1", filter: "none", clipPath: "none", mixBlendMode: "normal", isolation: "auto",
  backdropFilter: "none", webkitBackdropFilter: "none", maskImage: "none", webkitMaskImage: "none", ...overrides,
});
const element = (localName: string) => ({ localName, style: {}, ownerDocument: { styleSheets: [] } }) as unknown as Element;

test("media are mirrored and every other compositing trigger takes the glass itself", () => {
  expect(compositingReason(element("video"), style(), false)).toBe("media");
  expect(compositingReason(element("canvas"), style(), false)).toBe("media");
  expect(compositingReason(element("div"), style(), false)).toBeUndefined();
  expect(compositingReason(element("div"), style({ willChange: "transform" }), false)).toBe("layer");
  expect(compositingReason(element("div"), style({ willChange: "scroll-position, opacity" }), false)).toBe("layer");
  // WebKit does not composite for hints it cannot accelerate.
  expect(compositingReason(element("div"), style({ willChange: "contents" }), false)).toBeUndefined();
  expect(compositingReason(element("div"), style({ transform: "matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)" }), false)).toBe("layer");
  expect(compositingReason(element("div"), style({ backdropFilter: "blur(4px)" }), false)).toBe("layer");
  expect(compositingReason(element("div"), style({ filter: "saturate(2)" }), false)).toBe("layer");
  // A reference filter is painted with its element, never composited apart.
  expect(compositingReason(element("div"), style({ filter: 'url("#glass")' }), false)).toBeUndefined();
  expect(compositingReason(element("div"), style({ position: "sticky" }), false)).toBe("layer");
  expect(compositingReason(element("div"), style(), true)).toBe("layer");
});

test("an inline translateZ composites even though its computed matrix is 2D", () => {
  const inline = { localName: "div", style: { transform: "translateZ(0)", translate: "", rotate: "", scale: "" }, ownerDocument: { styleSheets: [] } } as unknown as Element;
  expect(compositingReason(inline, style({ transform: "matrix(1, 0, 0, 1, 0, 0)" }), false)).toBe("layer");
});

test("3D individual transform properties are recognized", () => {
  expect(has3DTransform(style({ translate: "10px 0px 5px" }))).toBe(true);
  expect(has3DTransform(style({ translate: "10px 0px" }))).toBe(false);
  expect(has3DTransform(style({ rotate: "x 45deg" }))).toBe(true);
  expect(has3DTransform(style({ rotate: "45deg" }))).toBe(false);
  expect(has3DTransform(style({ scale: "1 1 2" }))).toBe(true);
});

test("compositor animations are transform, opacity and filter changes", () => {
  expect(animatesInCompositor(["transform"])).toBe(true);
  expect(animatesInCompositor(["offset", "opacity"])).toBe(true);
  expect(animatesInCompositor(["background-color", "width"])).toBe(false);
});

test("layers painted after and over a composited layer are composited too", () => {
  const video = { name: "video" }, caption = { name: "caption" }, aside = { name: "aside" }, inner = { name: "inner" }, before = { name: "before" };
  const box = (x: number, y: number, w = 100, h = 50) => ({ x, y, w, h });
  const escaped = overlapComposited(
    [{ item: video, box: box(0, 0, 200, 100), order: 2 }],
    [
      { item: before, box: box(10, 10), order: 1 },
      { item: caption, box: box(50, 80), order: 3 },
      { item: inner, box: box(20, 20), order: 4 },
      // Overlaps only the caption, which became composited first.
      { item: aside, box: box(140, 120), order: 5 },
    ],
    (a, b) => (a === video && b === inner) || (a === inner && b === video),
  );
  expect(escaped).toEqual([caption, aside]);
});

test("positioned, transparent and effect layers create layers", () => {
  expect(createsLayer(style())).toBe(false);
  expect(createsLayer(style({ position: "relative" }))).toBe(true);
  expect(createsLayer(style({ opacity: "0.5" }))).toBe(true);
  expect(createsLayer(style({ clipPath: "inset(2px)" }))).toBe(true);
});

test("painted animations are any that change more than transform, opacity or filter", () => {
  expect(animatesPaint(["background-position", "offset", "easing", "composite", "computed-offset"])).toBe(true);
  expect(animatesPaint(["transform", "opacity", "offset", "easing", "composite", "computed-offset"])).toBe(false);
  expect(animatesPaint(["color"])).toBe(true);
});
