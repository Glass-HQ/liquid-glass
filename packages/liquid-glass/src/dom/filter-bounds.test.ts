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
  expect(tiles.markup.match(/<feTile/g)).toHaveLength(3);
  expect(edgeTiles(500, 400, bounds, "scene", crossedSides(500, 400, [inside])).markup).toBe("");
});
