import { expect, test } from "bun:test";
import { acquireFilterPaintRoot, acquireSceneCompositingLayer } from "./filter-paint-root.js";

function target(inline = "", priority = "", computed = inline || "auto") {
  const declarations = new Map<string, [string, string]>([["transform", ["rotate(7deg) scale(.8)", ""]]]);
  if (inline) declarations.set("will-change", [inline, priority]);
  const style = {
    getPropertyValue: (name: string) => declarations.get(name)?.[0] ?? "",
    getPropertyPriority: (name: string) => declarations.get(name)?.[1] ?? "",
    setProperty: (name: string, value: string, weight = "") => { declarations.set(name, [value, weight]); },
    removeProperty: (name: string) => { const value = declarations.get(name)?.[0] ?? ""; declarations.delete(name); return value; },
  };
  return {
    style,
    ownerDocument: { defaultView: { getComputedStyle: () => ({ willChange: computed }) } },
  } as unknown as HTMLElement;
}

test("a stylesheet hint is retained while active and its cascade is restored on release", () => {
  const element = target("", "", "opacity, scroll-position");
  const release = acquireFilterPaintRoot(element);
  expect(element.style.getPropertyValue("will-change")).toBe("opacity, scroll-position, transform");
  expect(element.style.getPropertyPriority("will-change")).toBe("important");
  expect(element.style.getPropertyValue("transform")).toBe("rotate(7deg) scale(.8)");
  release();
  expect(element.style.getPropertyValue("will-change")).toBe("");
});

test("overlapping scene and foreground claims restore the original declaration only after both release", () => {
  const element = target("opacity", "important");
  const scene = acquireFilterPaintRoot(element);
  const foreground = acquireFilterPaintRoot(element);
  scene();
  scene();
  expect(element.style.getPropertyValue("will-change")).toBe("opacity, transform");
  foreground();
  expect(element.style.getPropertyValue("will-change")).toBe("opacity");
  expect(element.style.getPropertyPriority("will-change")).toBe("important");
});

test("author-owned transform hints and subsequent author edits survive release", () => {
  const existing = target("transform, opacity");
  acquireFilterPaintRoot(existing)();
  expect(existing.style.getPropertyValue("will-change")).toBe("transform, opacity");
  expect(existing.style.getPropertyPriority("will-change")).toBe("");

  const changed = target("auto");
  const release = acquireFilterPaintRoot(changed);
  expect(changed.style.getPropertyValue("will-change")).toBe("transform");
  changed.style.setProperty("will-change", "contents");
  release();
  expect(changed.style.getPropertyValue("will-change")).toBe("contents");
});

test("replacing a target and acquiring it again starts with fresh ownership", () => {
  const previous = target("opacity");
  const next = target();
  acquireFilterPaintRoot(previous)();
  const releaseNext = acquireFilterPaintRoot(next);
  expect(previous.style.getPropertyValue("will-change")).toBe("opacity");
  expect(next.style.getPropertyValue("will-change")).toBe("transform");
  releaseNext();
  const releaseAgain = acquireFilterPaintRoot(next);
  releaseAgain();
  expect(next.style.getPropertyValue("will-change")).toBe("");
});

test("scene compositing preserves transforms and releases mixed claims independently", () => {
  for (const sceneFirst of [true, false]) {
    const element = target("scroll-position", "important");
    const releaseScene = acquireSceneCompositingLayer(element);
    expect(element.style.getPropertyValue("will-change")).toBe("scroll-position, opacity");
    expect(element.style.getPropertyValue("transform")).toBe("rotate(7deg) scale(.8)");
    // DOM callers can filter the scene root itself.
    const releaseContent = acquireFilterPaintRoot(element);
    expect(element.style.getPropertyValue("will-change")).toBe("scroll-position, opacity, transform");
    (sceneFirst ? releaseScene : releaseContent)();
    expect(element.style.getPropertyValue("will-change")).toBe(`scroll-position, ${sceneFirst ? "transform" : "opacity"}`);
    (sceneFirst ? releaseContent : releaseScene)();
    expect(element.style.getPropertyValue("will-change")).toBe("scroll-position");
    expect(element.style.getPropertyPriority("will-change")).toBe("important");
  }
});

test("author edits survive releasing or adding mixed paint claims", () => {
  const element = target();
  const releaseScene = acquireSceneCompositingLayer(element);
  element.style.setProperty("will-change", "contents");
  const releaseContent = acquireFilterPaintRoot(element);
  releaseScene();
  releaseContent();
  expect(element.style.getPropertyValue("will-change")).toBe("contents");
  expect(element.style.getPropertyPriority("will-change")).toBe("");
});

test("authored opacity survives releasing a temporary transform claim", () => {
  const element = target("", "", "opacity");
  const releaseScene = acquireSceneCompositingLayer(element);
  const releaseContent = acquireFilterPaintRoot(element);
  releaseContent();
  expect(element.style.getPropertyValue("will-change")).toBe("");
  releaseScene();
  expect(element.style.getPropertyValue("will-change")).toBe("");
});
