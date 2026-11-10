import { expect, test } from "bun:test";
import { generatePath } from "@lisse/core";
import { cornerPath } from "./corner-path.js";

test("continuous corners match Lisse byte for byte across sizes, radii and regimes", () => {
  const radii = [0, 0.5, 3, 8, 12.25, 16, 22, 28, 40, 99.5, Number.MAX_SAFE_INTEGER];
  const sizes = [0, 1, 2.5, 7, 16, 23.75, 31, 44, 44.5, 52, 57.3, 64, 80, 100.25, 128, 200, 333.33, 640];
  let checked = 0;
  for (const curve of ["squircle", "arc"] as const)
    for (const preserveSmoothing of [true, false])
      for (const smoothing of [0, 0.6, 0.8125, 1])
        for (const radius of radii)
          for (const width of sizes)
            for (const height of sizes) {
              const options = { radius, smoothing, preserveSmoothing, curve };
              expect(cornerPath(width, height, options)).toBe(generatePath(width, height, options));
              checked++;
            }
  expect(checked).toBeGreaterThan(40000);
});
