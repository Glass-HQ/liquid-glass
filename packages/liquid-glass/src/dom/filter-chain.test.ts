import { expect, test } from "bun:test";
import { registerSceneRoot, releaseFilterPart, sceneDepth, setFilterPart } from "./filter-chain.js";

function target(inline = "", priority = "") {
  const declarations = new Map<string, [string, string]>();
  if (inline) declarations.set("filter", [inline, priority]);
  return {
    style: {
      getPropertyValue: (name: string) => declarations.get(name)?.[0] ?? "",
      getPropertyPriority: (name: string) => declarations.get(name)?.[1] ?? "",
      setProperty: (name: string, value: string, weight = "") => { declarations.set(name, [value, weight]); },
      removeProperty: (name: string) => { declarations.delete(name); return ""; },
    },
    ownerDocument: { defaultView: { getComputedStyle: () => ({ filter: "none" }) } },
  } as unknown as HTMLElement;
}

test("an inner scene filters before an outer one, after the authored filter", () => {
  const element = target("saturate(2)", "important");
  setFilterPart(element, "outer", 0, 'url("#outer")');
  setFilterPart(element, "inner", 1, 'url("#inner")');
  expect(element.style.getPropertyValue("filter")).toBe('saturate(2) url("#inner") url("#outer")');
  expect(element.style.getPropertyPriority("filter")).toBe("important");
  // An empty part keeps its claim without drawing.
  setFilterPart(element, "inner", 1, "");
  expect(element.style.getPropertyValue("filter")).toBe('saturate(2) url("#outer")');
  releaseFilterPart(element, "outer");
  expect(element.style.getPropertyValue("filter")).toBe("saturate(2)");
  releaseFilterPart(element, "inner");
  expect(element.style.getPropertyValue("filter")).toBe("saturate(2)");
});

test("the authored filter returns once every part is released", () => {
  const element = target();
  setFilterPart(element, "a", 0, 'url("#a")');
  releaseFilterPart(element, "a");
  expect(element.style.getPropertyValue("filter")).toBe("");
  // Releasing an unknown owner is harmless.
  releaseFilterPart(element, "missing");
});

test("scene depth counts registered enclosing scenes", () => {
  const outer = { parentElement: null } as unknown as Element;
  const middle = { parentElement: outer } as unknown as Element;
  const inner = { parentElement: middle } as unknown as Element;
  const release = registerSceneRoot(outer);
  expect(sceneDepth(inner)).toBe(1);
  registerSceneRoot(middle);
  expect(sceneDepth(inner)).toBe(2);
  release();
  expect(sceneDepth(inner)).toBe(1);
});
