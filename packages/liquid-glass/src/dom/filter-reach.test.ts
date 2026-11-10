import { expect, test } from "bun:test";
import { padRepaintReach, repaintReach } from "./filter-reach.js";
import { progressiveGraph } from "./progressive.js";
import { filterGraphOutsets } from "./filter-budget.js";

// A lens near the top of a tall element, like a sidebar's menu button.
const graph = `<feImage x="8" y="8" width="32" height="32" result="map"/>`
  + `<feGaussianBlur in="map" stdDeviation="2" x="6" y="6" width="36" height="36" result="glass"/>`
  + `<feMerge result="scene"><feMergeNode in="SourceGraphic"/><feMergeNode in="glass"/></feMerge>`;

test("reach covers the farthest gap between the element and any subregion", () => {
  // The bottom edge is 400 - 42 = 358 px from the blur; both growths count.
  const reach = repaintReach(graph, 216, 400);
  expect(reach).toBeGreaterThanOrEqual(358 / 2);
  expect(repaintReach(graph, 216, 400, [{ x: 0, y: 380, width: 216, height: 20 }])).toBeGreaterThanOrEqual(reach);
  expect(repaintReach(`<feMerge><feMergeNode in="SourceGraphic"/></feMerge>`, 216, 400)).toBe(0);
});

const regionOf = (markup: string, result: string) => {
  const tag = new RegExp(`<fe\\w+[^>]*result="${result}"[^>]*>`).exec(markup)![0];
  const value = (name: string) => Number(new RegExp(`\\s${name}="([-\\d.e]+)"`).exec(tag)![1]);
  return { x: value("x"), y: value("y"), width: value("width"), height: value("height") };
};

test("padding joins the final merge as a one-pixel transparent branch", () => {
  const padded = padRepaintReach(graph, 192, 216, 400);
  const merge = padded.slice(padded.lastIndexOf("<feMerge "));
  expect(merge.startsWith(`<feMerge result="scene"><feMergeNode in="reach"/>`)).toBe(true);
  // No full-size fill: the seed and its displacement cover one pixel.
  expect(regionOf(padded, "reach-seed")).toEqual({ x: 8, y: 8, width: 1, height: 1 });
  expect(regionOf(padded, "reach")).toEqual({ x: 8, y: 8, width: 1, height: 1 });
  expect(padded).toContain('flood-opacity="0"');
  // As a merge sibling the padding raises the outsets, rather than adding to the lens.
  expect(filterGraphOutsets(padded)).toBeGreaterThanOrEqual(192);
  expect(filterGraphOutsets(padded)).toBeLessThan(192 + 4);
});

test("the seed lies inside an existing region, which any repaint reaches", () => {
  // The first region extends past the element; the seed uses the next one inside it.
  const edged = `<feTile in="SourceGraphic" x="0" y="-20" width="216" height="20" result="edge"/>` + graph;
  const seed = regionOf(padRepaintReach(edged, 192, 216, 400), "reach-seed");
  expect(seed.x).toBeGreaterThanOrEqual(8);
  expect(seed.y).toBeGreaterThanOrEqual(8);
  expect(seed.x + seed.width).toBeLessThanOrEqual(40);
  expect(seed.y + seed.height).toBeLessThanOrEqual(40);
});

test("reach includes existing branched blur outsets without charging them twice", () => {
  for (const width of [216, 992]) for (const height of [390, 818]) for (const blur of [0, 20, 60]) {
    const regions = [
      { edge: "top" as const, x: 0, y: 0, width, height: 100, blur, refraction: 8 },
      { edge: "bottom" as const, x: 0, y: height - 100, width, height: 100, blur, refraction: 8 },
    ];
    const original = progressiveGraph("p", regions, width, height, "webkit");
    const natural = filterGraphOutsets(original);
    for (const extra of [16, 100, 800]) {
      const requested = natural + extra;
      const padded = padRepaintReach(original, requested, width, height);
      expect(filterGraphOutsets(padded)).toBeGreaterThanOrEqual(requested);
      expect(filterGraphOutsets(padded)).toBeLessThan(requested + 32);
    }
  }
});

test("tiny targets without regions seed their center and keep every image nonempty", () => {
  const thin = '<feMerge><feMergeNode in="SourceGraphic"/></feMerge>';
  for (const width of [0.5, 1, 2, 3, 4]) for (const height of [width, 400]) {
    const padded = padRepaintReach(thin, 400, width, height);
    const seed = regionOf(padded, "reach-seed");
    // WebKit aborts the whole filter if any intermediate image rect is empty.
    expect(Math.min(width, seed.x + seed.width) - Math.max(0, seed.x)).toBeGreaterThan(0);
    expect(Math.min(height, seed.y + seed.height) - Math.max(0, seed.y)).toBeGreaterThan(0);
    expect(filterGraphOutsets(padded)).toBeGreaterThanOrEqual(400);
  }
});

test("without a region or enough reach for the center, opposed offsets of a flood pad the element", () => {
  const thin = '<feMerge><feMergeNode in="SourceGraphic"/></feMerge>';
  const padded = padRepaintReach(thin, 50, 992, 390);
  expect(padded).toContain('dx="50" dy="50"');
  expect(padded).toContain('dx="-50" dy="-50"');
  expect(regionOf(padded, "reach-seed")).toEqual({ x: 0, y: 0, width: 992, height: 390 });
});
