import { expect, test } from "bun:test";
import { padRepaintReach, repaintReach } from "./filter-reach.js";
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

test("padding joins the final merge and stays within half the element", () => {
  const padded = padRepaintReach(graph, 192, 216, 400);
  const merge = padded.slice(padded.lastIndexOf("<feMerge "));
  expect(merge.startsWith(`<feMerge result="scene"><feMergeNode in="reach-after"/><feMergeNode in="reach-before"/>`)).toBe(true);
  expect(padded).toContain('dx="108" dy="192"');
  expect(padded).toContain('dx="-108" dy="-192"');
  // As merge siblings the offsets raise the outsets, rather than adding to the lens.
  expect(filterGraphOutsets(padded)).toBe(Math.max(192, filterGraphOutsets(graph)));
});

test("tiled padding blurs a transparent flood instead of moving it", () => {
  const padded = padRepaintReach(graph, 1200, 216, 400, true);
  expect(padded).not.toContain("feOffset");
  // WebKit caps one blur's kernel, so long reaches chain blurs that add up.
  expect(padded.match(/result="reach-\d+"/g)!.length).toBe(2);
  expect(filterGraphOutsets(padded)).toBeGreaterThanOrEqual(1200);
});
