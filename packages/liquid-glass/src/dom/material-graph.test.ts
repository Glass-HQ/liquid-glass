import { expect, test } from "bun:test";
import {
  backdropMarkup,
  hasBackdrop,
  lightMarkup,
  tintMarkup,
  toneMarkup,
} from "./material-graph.js";

test("an unset or transparent backdrop paints nothing", () => {
  for (const value of [
    "",
    "  ",
    "transparent",
    "rgba(0, 0, 0, 0)",
    "rgba(10, 10, 10, 0)",
    "color(srgb 1 1 1 / 0)",
    "oklch(0.5 0.1 200 / 0%)",
  ])
    expect(hasBackdrop(value)).toBe(false);
  for (const value of [
    "#0a0a0a",
    "rgb(0, 0, 0)",
    "rgb(10, 10, 0)",
    "rgba(0, 0, 0, 0.5)",
    "white",
    "color(srgb 0 0 0)",
    "oklch(0.5 0.1 200 / 0.4)",
  ])
    expect(hasBackdrop(value)).toBe(true);
});

test("the backdrop color resolves from --lg-backdrop where the filter is", () => {
  expect(backdropMarkup("b", { x: 1, y: 2, width: 3, height: 4 })).toBe(
    '<feFlood style="flood-color:var(--lg-backdrop, transparent)" x="1" y="2" width="3" height="4" result="b"/>',
  );
});

test("the lit face is masked once, so a partly covered rim pixel keeps its coverage", () => {
  const markup = lightMarkup("p", "pcolor", "plight", "pfield");
  expect(markup.match(/operator="in"/g)).toHaveLength(1);
  expect(markup).toContain('in="pcolor" in2="plight"');
  expect(markup).toContain('result="plitInside"');
});

test("tinted glass names every filter result once", () => {
  const options = { material: "regular" as const, appearance: "dark" as const, tint: "#007aff" };
  const markup = toneMarkup("p", options, 44) + tintMarkup("p", options, [0, 0.48, 1]).markup;
  const results = [...markup.matchAll(/result="([^"]+)"/g)].map((match) => match[1]);
  expect(new Set(results).size).toBe(results.length);
});
