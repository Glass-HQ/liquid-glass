import { expect, test } from "bun:test";
import { filterGraphOutsets, isWebKit } from "./filter-budget.js";

test("WebKit filter behavior follows the engine across iOS browser brands", () => {
  for (const brand of ["Version/27.2 Safari/605.1.15", "CriOS/145.0 Mobile/15E148 Safari/604.1", "FxiOS/145.0 Mobile/15E148 Safari/605.1.15", "EdgiOS/145.0 Mobile/15E148 Safari/605.1.15"])
    expect(isWebKit({ vendor: "", userAgent: `Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 ${brand}` })).toBe(true);
  expect(isWebKit({ vendor: "Apple Computer, Inc.", userAgent: "Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/27.2 Safari/605.1.15" })).toBe(true);
  for (const brand of ["Chrome/145.0", "Chrome/145.0 Edg/145.0", "Chrome/145.0 Electron/41.0", "Chrome/145.0 SamsungBrowser/29.0"])
    expect(isWebKit({ vendor: "Google Inc.", userAgent: `Mozilla/5.0 AppleWebKit/537.36 ${brand} Safari/537.36` })).toBe(false);
  expect(isWebKit({ vendor: "", userAgent: "Mozilla/5.0 Gecko/20100101 Firefox/145.0" })).toBe(false);
});


test("WebKit outset accounting follows repeated graph inputs, not unique primitives", () => {
  const blur = '<feGaussianBlur in="SourceGraphic" stdDeviation="10" result="blur"/>';
  const wrapped = '<feComposite in="blur" in2="SourceAlpha" operator="in" result="clip"/><feMerge result="wrapped"><feMergeNode in="clip"/></feMerge>';
  expect(filterGraphOutsets(blur)).toBe(28);
  expect(filterGraphOutsets(blur + wrapped + '<feMerge><feMergeNode in="wrapped"/><feMergeNode in="blur"/></feMerge>')).toBe(56);
  expect(filterGraphOutsets(blur + '<feDisplacementMap in="blur" in2="SourceAlpha" scale="20"/>')).toBe(38);
});

test("normalized progressive blur outsets resolve against both content dimensions", () => {
  const normalized = '<feGaussianBlur in="SourceGraphic" stdDeviation="0.02 0.05" result="blur"/>';
  expect(filterGraphOutsets(normalized, 500, 200)).toBe(28);
  expect(filterGraphOutsets('<feImage href="map" result="map"/><feDisplacementMap in="SourceGraphic" in2="map" scale="0.04"/>', 500, 200)).toBe(10);
  expect(filterGraphOutsets('<feMerge><feMergeNode in="SourceGraphic"/></feMerge>')).toBe(0);
});
