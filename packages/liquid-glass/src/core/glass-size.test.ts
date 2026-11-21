import { expect, test } from "bun:test";
import { glassRecipe, glassSize } from "./materials.js";

test("floating glass looks like a panel whatever its size", () => {
  const menu = { material: "regular" as const, appearance: "dark" as const, floating: true };
  expect(glassSize(menu, 128, 64)).toBe(160);
  expect(glassSize(menu, 128, 232)).toBe(160);
  expect(glassRecipe(menu, glassSize(menu, 128, 64))).toEqual(
    glassRecipe(menu, glassSize(menu, 128, 232)),
  );
  // Glass in a page keeps the size rule.
  expect(glassSize({ material: "regular" }, 128, 64)).toBe(64);
});
