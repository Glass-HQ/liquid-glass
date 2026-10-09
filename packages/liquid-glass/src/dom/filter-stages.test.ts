import { expect, test } from "bun:test";
import { filterPrimitiveCount } from "./filter-stages.js";

test("the graph cap counts transfer and merge primitives, not their children", () => {
  const graph = `<feImage result="map"/><feComponentTransfer in="map"><feFuncR type="identity"/><feFuncG type="identity"/><feFuncB type="identity"/><feFuncA type="identity"/></feComponentTransfer><feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="map"/></feMerge>`;
  expect(filterPrimitiveCount(graph)).toBe(3);
});
