import { expect, test } from "bun:test";
import { materials } from "../core/materials.js";
import { toneFilters } from "./native-frost.js";

test("the straight-line tone stays within a few levels of the tone curve", () => {
  for (const appearance of ["light", "dark"] as const) {
    const [, contrast, brightness] = /contrast\(([\d.]+)\) brightness\(([\d.]+)\)/
      .exec(toneFilters({ material: "regular", appearance }))!
      .map(Number);
    const [a, b, q] = materials.regular[appearance].tone;
    const weight = appearance === "dark" ? 0.9 : 0.8;
    for (let v = 0; v <= 1; v += 1 / 64) {
      const curve = weight * (a + b * v + q * v * v) + (1 - weight) * v;
      const line = brightness! * (contrast! * v + 0.5 * (1 - contrast!));
      expect(Math.abs(curve - line)).toBeLessThan((appearance === "dark" ? 6.1 : 3) / 255);
    }
  }
});
