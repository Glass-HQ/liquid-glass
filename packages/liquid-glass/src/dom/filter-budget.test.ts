import { expect, test } from "bun:test";
import { isWebKit } from "./filter-budget.js";

test("WebKit filter behavior follows the engine across iOS browser brands", () => {
  for (const brand of ["Version/27.2 Safari/605.1.15", "CriOS/145.0 Mobile/15E148 Safari/604.1", "FxiOS/145.0 Mobile/15E148 Safari/605.1.15", "EdgiOS/145.0 Mobile/15E148 Safari/605.1.15"])
    expect(isWebKit({ vendor: "", userAgent: `Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 ${brand}` })).toBe(true);
  expect(isWebKit({ vendor: "Apple Computer, Inc.", userAgent: "Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/27.2 Safari/605.1.15" })).toBe(true);
  for (const brand of ["Chrome/145.0", "Chrome/145.0 Edg/145.0", "Chrome/145.0 Electron/41.0", "Chrome/145.0 SamsungBrowser/29.0"])
    expect(isWebKit({ vendor: "Google Inc.", userAgent: `Mozilla/5.0 AppleWebKit/537.36 ${brand} Safari/537.36` })).toBe(false);
  expect(isWebKit({ vendor: "", userAgent: "Mozilla/5.0 Gecko/20100101 Firefox/145.0" })).toBe(false);
});
