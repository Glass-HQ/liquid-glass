import { expect, test } from "bun:test";
import { layoutRect } from "./layout-rect.js";

const box = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
  width,
  height,
});

test("a box inside pressed glass keeps its layout position", () => {
  // A 100x40 toolbar at (100, 100) scaled 1.1 about its center, holding a
  // 20x20 button at (110, 110) in layout.
  const toolbar = {
    style: { scale: "1.1 1.1" },
    parentElement: null,
    getBoundingClientRect: () => box(95, 98, 110, 44),
  };
  const button = {
    style: { scale: "" },
    parentElement: toolbar,
    getBoundingClientRect: () => box(95 + 10 * 1.1, 98 + 10 * 1.1, 22, 22),
  };
  const original = globalThis.getComputedStyle;
  globalThis.getComputedStyle = (() => ({ transformOrigin: "50px 20px" })) as never;
  try {
    const rect = layoutRect(button as unknown as HTMLElement);
    expect(rect.left).toBeCloseTo(110);
    expect(rect.top).toBeCloseTo(110);
    expect(rect.width).toBeCloseTo(20);
    expect(rect.height).toBeCloseTo(20);
  } finally {
    globalThis.getComputedStyle = original;
  }
});
