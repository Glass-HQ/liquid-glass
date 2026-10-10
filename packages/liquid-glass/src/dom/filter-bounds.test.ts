import { expect, test } from "bun:test";
import { filterBounds } from "./filter-bounds";

test("optical bounds contain hover growth and popups on every side of a scene", () => {
  for (const [width, height] of [[1000, 28], [28, 1000], [100, 100]]) {
    const surfaces = [
      { x: -2, y: -1, width: width + 4, height: height + 2 },
      { x: width - 128, y: height + 8, width: 128, height: 120 },
      { x: -136, y: -128, width: 128, height: 120 },
    ];
    const bounds = filterBounds(width, height, surfaces, 130);
    for (const rect of [{ x: 0, y: 0, width, height }, ...surfaces]) {
      expect(rect.x - bounds.x).toBeGreaterThanOrEqual(130);
      expect(rect.y - bounds.y).toBeGreaterThanOrEqual(130);
      expect(bounds.x + bounds.width - rect.x - rect.width).toBeGreaterThanOrEqual(130);
      expect(bounds.y + bounds.height - rect.y - rect.height).toBeGreaterThanOrEqual(130);
    }
  }
});

test("closed popups do not leave an expanded optical region behind", () => {
  const scene = filterBounds(100, 28, [], 130);
  expect(scene).toEqual({ x: -130, y: -130, width: 360, height: 288 });
});

import { crossedSides, edgeTiles, tilesFor } from "./filter-bounds";

test("edge tiles exist only for the sides and corners some crop reaches past", () => {
  const inside = { x: 50, y: 50, width: 100, height: 100 };
  const bottomRight = { x: 400, y: 300, width: 200, height: 200 };
  expect(tilesFor(500, 400, inside)).toEqual([]);
  expect(tilesFor(500, 400, bottomRight)).toEqual(["21", "12", "22"]);
  const sides = crossedSides(500, 400, [inside, bottomRight]);
  expect(sides).toMatchObject({ left: false, top: false, right: true, bottom: true });
  expect([...sides.corners]).toEqual(["22"]);
  const bounds = filterBounds(500, 400, [inside, bottomRight], 0);
  const tiles = edgeTiles(500, 400, bounds, "scene", sides);
  expect(Object.keys(tiles.names).sort()).toEqual(["12", "21", "22"]);
  expect(tiles.markup.match(/<feTile/g)).toHaveLength(4);
  expect(edgeTiles(500, 400, bounds, "scene", crossedSides(500, 400, [inside])).markup).toBe("");
});

interface RasterRect { x: number; y: number; width: number; height: number }
interface TilePrimitive { tag: string; input: string; result: string; rect: RasterRect }
const repeat = (value: number, origin: number, period: number) => origin + ((value - origin) % period + period) % period;
// Filter primitive subregions round out to device pixels in Gecko. Interpret
// the emitted graph, then compare its pixels against direct corner tiling.
function rasterTiles(markup: string, dpr: number) {
  const primitives = [...markup.matchAll(/<(feOffset|feTile)\b([^>]+)\/>/g)].map((match): TilePrimitive => {
    const a = Object.fromEntries([...match[2]!.matchAll(/([\w-]+)="([^"]*)"/g)].map((attribute) => [attribute[1]!, attribute[2]!]));
    const x = Math.floor(Number(a.x) * dpr), y = Math.floor(Number(a.y) * dpr);
    return { tag: match[1]!, input: a.in!, result: a.result!, rect: {
      x, y, width: Math.ceil((Number(a.x) + Number(a.width)) * dpr) - x,
      height: Math.ceil((Number(a.y) + Number(a.height)) * dpr) - y,
    } };
  });
  const nodes = new Map(primitives.map((node) => [node.result, node]));
  // Nonuniform premultiplied RGBA, including fully transparent source pixels.
  const source = (x: number, y: number) => {
    const alpha = ((x * 31 + y * 43) % 256 + 256) % 256;
    return [Math.min(alpha, (x * 17 + 53) & 255), Math.min(alpha, (y * 23 + 79) & 255), alpha >> 1, alpha];
  };
  const pixel = (name: string, x: number, y: number): number[] => {
    const node = nodes.get(name);
    if (!node) return source(x, y);
    const r = node.rect;
    if (x < r.x || y < r.y || x >= r.x + r.width || y >= r.y + r.height) return [0, 0, 0, 0];
    if (node.tag === "feOffset") return pixel(node.input, x, y);
    const input = nodes.get(node.input)!.rect;
    return pixel(node.input, repeat(x, input.x, input.width), repeat(y, input.y, input.height));
  };
  return { nodes, primitives, pixel, source };
}

test("separable corner tiles preserve nonuniform RGBA pixels and phase at fractional bounds and device scales", () => {
  for (const dpr of [1, 1.25, 1.5, 2]) {
    for (const [width, height] of [[10, 8], [10.25, 8.75], [0.75, 0.5]]) {
      const bounds = { x: -6.25, y: -5.75, width: width + 13.5, height: height + 12.25 };
      const tiles = edgeTiles(width!, height!, bounds, "scene", crossedSides(width!, height!, [bounds]), "finishedBackdrop");
      const raster = rasterTiles(tiles.markup, dpr);
      expect(new Set(raster.primitives.map((node) => node.result)).size).toBe(raster.primitives.length);
      for (const corner of ["00", "20", "02", "22"]) {
        const original = raster.nodes.get(`sceneedge${corner}`)!;
        const output = raster.nodes.get(tiles.names[corner]!)!;
        for (let y = output.rect.y; y < output.rect.y + output.rect.height; y++) {
          for (let x = output.rect.x; x < output.rect.x + output.rect.width; x++) {
            const expected = raster.source(repeat(x, original.rect.x, original.rect.width), repeat(y, original.rect.y, original.rect.height));
            expect(raster.pixel(output.result, x, y)).toEqual(expected);
          }
        }
      }
    }
  }
});

test("DPR2 corner source retains its four distinct pixels while side tiles stay single pass", () => {
  const bounds = { x: -10, y: -10, width: 30, height: 30 };
  const tiles = edgeTiles(10, 10, bounds, "scene", crossedSides(10, 10, [bounds]));
  const raster = rasterTiles(tiles.markup, 2);
  const samples = [-4, -3].flatMap((y) => [-4, -3].map((x) => raster.pixel(tiles.names["00"]!, x, y).join(",")));
  expect(new Set(samples).size).toBe(4);
  for (const side of ["01", "10", "21", "12"]) {
    expect(raster.nodes.get(tiles.names[side]!)!.input).toBe(`sceneedge${side}`);
    expect(raster.nodes.has(`sceneedge${side}row`)).toBe(false);
  }
});
