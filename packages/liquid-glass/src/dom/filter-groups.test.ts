import { expect, test } from "bun:test";
import { clusterFilterBranches, mapBoxesOverlap } from "./filter-groups.js";
import type { BranchRegions } from "./filter-groups.js";

test("visible glass can be separate while its opaque map padding overlaps", () => {
  const a = { x: 0, y: 0, w: 20, h: 20 };
  expect(mapBoxesOverlap(a, { ...a, x: 21 })).toBe(true);
  expect(mapBoxesOverlap(a, { ...a, x: 23.9 })).toBe(true);
  expect(mapBoxesOverlap(a, { ...a, x: 24 })).toBe(false);
  expect(mapBoxesOverlap(a, { ...a, y: 23.9 })).toBe(true);
  expect(mapBoxesOverlap(a, { ...a, y: 24 })).toBe(false);
});

const regions = ({ x, y }: { x: number; y: number }): BranchRegions => ({
  output: { x, y, width: 44, height: 44 },
  crop: { x: x - 80, y: y - 80, width: 204, height: 204 },
  sampled: { x: x - 63, y: y - 63, width: 170, height: 170 },
});

test("nearby compatible glass shares a pass, but distant perimeters stay separate", () => {
  const a = { x: 0, y: 0 }, b = { x: 48, y: 0 }, c = { x: 1000, y: 800 };
  expect(clusterFilterBranches([a, b, c], regions, { output: 4, sampled: 4 })).toEqual([[a, b], [c]]);
  expect(clusterFilterBranches([a, c], regions, { output: 4, sampled: 4 })).toEqual([[a], [c]]);
});

test("the area model includes plane merges instead of grouping every nearby clear lens", () => {
  const a = { x: 0, y: 0 }, b = { x: 100, y: 0 };
  expect(clusterFilterBranches([a, b], regions, { output: 3, sampled: 0 })).toEqual([[a], [b]]);
});

test("clusters retain member identity and stable order through repeated measurements", () => {
  const lenses = [{ x: 0, y: 0 }, { x: 48, y: 0 }, { x: 1000, y: 800 }, { x: 1048, y: 800 }];
  const first = clusterFilterBranches(lenses, regions, { output: 4, sampled: 4 });
  expect(first).toEqual([lenses.slice(0, 2), lenses.slice(2)]);
  expect(clusterFilterBranches(lenses, regions, { output: 4, sampled: 4 })).toEqual(first);
  expect(first[0]![0]).toBe(lenses[0]);
  expect(first[1]![0]).toBe(lenses[2]);
});

test("a branch limit rejoins the nearest branches and leaves the outlier apart", () => {
  // A row of three distant buttons and one far corner, like a toolbar.
  const row = [{ x: 0, y: 600 }, { x: 300, y: 600 }, { x: 600, y: 600 }], corner = { x: 1200, y: 0 };
  const stages = { output: 3, sampled: 0 };
  expect(clusterFilterBranches([...row, corner], regions, stages)).toHaveLength(4);
  expect(clusterFilterBranches([...row, corner], regions, stages, 2)).toEqual([row, [corner]]);
  expect(clusterFilterBranches([...row, corner], regions, stages, 1)).toEqual([[...row, corner]]);
});
