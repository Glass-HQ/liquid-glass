import { pngDataUrl } from "./png.js";
import { mapPlanes } from "../gpu/planes.js";

/** How to cut a map into nine tiles for Chromium's backdrop glass: the
 * corner tiles' width and height in map pixels. Between the corners a shape's
 * edge runs straight and its maps do not change along it, so one column or
 * row of pixels repeated across that span draws it exactly. */
export interface NineCut {
  x: number;
  y: number;
}
/** Encode GPU readback pixels, never DOM content. The atlas holds its planes
 * stacked vertically. Each plane yields its full image followed, for capsule
 * maps, by its left, middle, and right slices, and then, with a nine-slice
 * cut, by its nine tiles row by row: corners, and the single column or row
 * between them. Everything runs on the CPU of whichever thread calls it. */
export function encodeMapPixels(
  pixels: Uint8Array,
  width: number,
  height: number,
  cap?: number,
  nine?: NineCut,
): Promise<string[][]> {
  const stride = width * 4;
  // [left, top, width, height] in map pixels.
  const regions: [number, number, number, number][] = [[0, 0, width, height]];
  if (cap !== undefined)
    regions.push(
      [0, 0, cap, height],
      [cap, 0, width - 2 * cap, height],
      [width - cap, 0, cap, height],
    );
  if (nine) {
    const cx = Math.max(1, Math.min(nine.x, Math.ceil(width / 2)));
    const cy = Math.max(1, Math.min(nine.y, Math.ceil(height / 2)));
    const mx = Math.floor(width / 2),
      my = Math.floor(height / 2);
    for (const [top, rows] of [
      [0, cy],
      [my, 1],
      [height - cy, cy],
    ] as const)
      regions.push([0, top, cx, rows], [mx, top, 1, rows], [width - cx, top, cx, rows]);
  }
  return Promise.all(
    Array.from({ length: mapPlanes }, (_, plane) => {
      const base = plane * height * stride;
      return Promise.all(
        regions.map(([left, top, w, h]) =>
          pngDataUrl(
            w,
            h,
            pixels.subarray(base + top * stride + left * 4, base + (top + h) * stride),
            stride,
          ),
        ),
      );
    }),
  );
}
