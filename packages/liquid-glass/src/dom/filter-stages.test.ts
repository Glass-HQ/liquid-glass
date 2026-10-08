import { expect, test } from "bun:test";
import { filterPrimitiveCount, partitionFilterStages } from "./filter-stages.js";

test("the graph cap counts transfer and merge primitives, not their children", () => {
  const graph = `<feImage result="map"/><feComponentTransfer in="map"><feFuncR type="identity"/><feFuncG type="identity"/><feFuncB type="identity"/><feFuncA type="identity"/></feComponentTransfer><feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="map"/></feMerge>`;
  expect(filterPrimitiveCount(graph)).toBe(3);
});

const render = (groups: readonly number[]) =>
  groups.map((count, group) => Array.from({ length: count }, (_, index) => `<feImage result="s${group}p${index}"/>`).join("")).join("")
  + `<feMerge><feMergeNode in="SourceGraphic"/></feMerge>`;

test("partitions a graph exceeding Gecko's cap into separate ordered stages", () => {
  const stages = partitionFilterStages([23, 15, 23, 15, 15], render);
  expect(stages.map((stage) => stage.groups)).toEqual([[23, 15, 23], [15, 15]]);
  expect(stages.flatMap((stage) => stage.groups)).toEqual([23, 15, 23, 15, 15]);
  expect(stages.map((stage) => stage.primitives)).toEqual([62, 31]);
  for (const stage of stages) expect(filterPrimitiveCount(stage.markup)).toBeLessThanOrEqual(64);
});

test("accepts exactly 64 operations and reports an unpartitionable branch", () => {
  expect(partitionFilterStages([63], render)[0]?.primitives).toBe(64);
  expect(() => partitionFilterStages([64], render)).toThrow("One glass branch requires 65 filter operations");
  expect(partitionFilterStages([], render)).toEqual([]);
});
