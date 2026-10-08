import { pngDataUrl } from "./png.js";

/** Encode GPU readback pixels, never DOM content. The atlas holds four planes
 * stacked vertically. Each plane yields its full image followed, for capsule
 * maps, by its left, middle, and right slices. Everything runs on the CPU of
 * whichever thread calls it. */
export function encodeMapPixels(pixels: Uint8Array, width: number, height: number, cap?: number): Promise<string[][]> {
  const stride = width * 4;
  const regions = cap === undefined ? [[0, width]] : [[0, width], [0, cap], [cap, width - 2 * cap], [width - cap, cap]];
  return Promise.all(Array.from({ length: 4 }, (_, plane) => {
    const base = plane * height * stride;
    return Promise.all(regions.map(([offset, size]) =>
      pngDataUrl(size!, height, pixels.subarray(base + offset! * 4, base + height * stride), stride)));
  }));
}
