import { expect, test } from "bun:test";
import { PNG } from "pngjs";
import { base64, encodePng } from "./png.js";
import { encodeMapPixels } from "./map-encoding.js";

function gradient(width: number, height: number, planes = 1): Uint8Array {
  const pixels = new Uint8Array(width * height * planes * 4);
  for (let i = 0; i < width * height * planes; i++) {
    const x = i % width, y = Math.floor(i / width);
    pixels.set([x * 255 / Math.max(1, width - 1), y % 256, (x + y) % 256, 255 - (y % 7)], i * 4);
  }
  return pixels;
}
test("encodes RGBA pixels as a PNG that decodes to the same bytes", async () => {
  const width = 37, height = 11;
  const pixels = gradient(width, height);
  const png = PNG.sync.read(Buffer.from(await encodePng(width, height, pixels)));
  expect(png.width).toBe(width);
  expect(png.height).toBe(height);
  expect([...png.data]).toEqual([...pixels]);
});
test("encodes a column slice of a wider image through its stride", async () => {
  const width = 24, height = 5;
  const pixels = gradient(width, height);
  const png = PNG.sync.read(Buffer.from(await encodePng(6, height, pixels.subarray(8 * 4), width * 4)));
  for (let y = 0; y < height; y++) for (let x = 0; x < 6; x++) for (let c = 0; c < 4; c++)
    expect(png.data[(y * 6 + x) * 4 + c]).toBe(pixels[(y * width + 8 + x) * 4 + c]);
});
test("base64 matches the platform encoder", () => {
  for (const length of [0, 1, 2, 3, 4, 100, 257]) {
    const bytes = new Uint8Array(length).map((_, i) => (i * 73) % 256);
    expect(base64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  }
});
test("map planes and capsule slices are data URLs of the right size", async () => {
  const width = 30, height = 8;
  const planes = await encodeMapPixels(gradient(width, height, 4), width, height, 10);
  expect(planes).toHaveLength(4);
  for (const [plane, images] of planes.entries()) {
    expect(images).toHaveLength(4);
    const sizes = images.map((url) => PNG.sync.read(Buffer.from(url.slice("data:image/png;base64,".length), "base64")));
    expect(sizes.map((p) => [p.width, p.height])).toEqual([[30, 8], [10, 8], [10, 8], [10, 8]]);
    // The full image's first pixel of this plane matches the atlas.
    expect(sizes[0]!.data[1]).toBe((plane * height) % 256);
  }
});
