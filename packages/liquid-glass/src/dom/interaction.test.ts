import { expect, test } from "bun:test";
import { attachInteraction } from "./interaction.js";

function surface() {
  const values = new Map<string, string>();
  const listeners = new Map<string, (event: unknown) => void>();
  let writes = 0;
  const style = {
    get translate() { return values.get("translate") ?? ""; },
    set translate(value: string) { writes++; values.set("translate", value); },
    get scale() { return values.get("scale") ?? ""; },
    set scale(value: string) { writes++; values.set("scale", value); },
    getPropertyValue: (name: string) => values.get(name) ?? "",
    setProperty(name: string, value: string) { writes++; values.set(name, value); },
    removeProperty(name: string) { writes++; values.delete(name); },
  };
  const element = {
    ownerDocument: { defaultView: {
      matchMedia: () => ({ matches: true }),
      addEventListener() {}, removeEventListener() {},
    } },
    offsetWidth: 40, offsetHeight: 28,
    style,
    dataset: new Proxy<Record<string, string>>({}, {
      set(target, name: string, value: string) { writes++; target[name] = value; return true; },
      deleteProperty(target, name: string) { writes++; delete target[name]; return true; },
    }),
    matches: () => false,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 40, height: 28 }),
    addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
  } as unknown as HTMLElement;
  return {
    element, style,
    writes: () => writes,
    fire(type: string, detail: object = {}) { listeners.get(type)?.({ type, ...detail }); },
  };
}

test("a settled hover keeps its light without keeping the scene awake or rewriting styles", () => {
  const target = surface();
  const animator = attachInteraction(target.element, () => "full");
  target.fire("pointerenter", { pointerType: "mouse", clientX: 12, clientY: 10 });
  let active: boolean | void = true;
  for (let now = 100; now < 2000; now += 1000 / 60) active = animator.frame(now);
  expect(active).toBe(false);
  expect(target.style.getPropertyValue("--lg-glow")).toBe("0.3500");
  const writes = target.writes();
  for (let now = 2000; now < 3000; now += 1000 / 60) expect(animator.frame(now)).toBe(false);
  expect(target.writes()).toBe(writes);
  target.fire("pointermove", { pointerType: "mouse", clientX: 24, clientY: 10 });
  animator.frame(3016);
  expect(target.style.getPropertyValue("--lg-glow-x")).toBe("24.00px");
  target.fire("pointerleave", { pointerType: "mouse" });
  expect(animator.frame(3032)).toBe(true);
  for (let now = 3050; now < 5000; now += 1000 / 60) active = animator.frame(now);
  expect(active).toBe(false);
  expect(target.style.getPropertyValue("--lg-glow")).toBe("");
  animator.dispose();
});

test("press springs advance by elapsed time when rendering drops frames", () => {
  const fine = surface(), coarse = surface();
  const a = attachInteraction(fine.element, () => "full"), b = attachInteraction(coarse.element, () => "full");
  fine.fire("keydown", { key: "Enter" }); coarse.fire("keydown", { key: "Enter" });
  a.frame(100); b.frame(100);
  for (let now = 110; now <= 300; now += 10) a.frame(now);
  b.frame(300);
  expect(coarse.style.scale).toBe(fine.style.scale);
  expect(coarse.style.getPropertyValue("--lg-glow")).toBe(fine.style.getPropertyValue("--lg-glow"));
  a.dispose(); b.dispose();
});

test("a new press after idle does not consume the time spent asleep", () => {
  const target = surface();
  const animator = attachInteraction(target.element, () => "full");
  expect(animator.frame(100)).toBe(false);
  target.fire("keydown", { key: "Enter" });
  expect(animator.frame(10000)).toBe(true);
  const scale = parseFloat(target.style.scale);
  expect(scale).toBeGreaterThan(1);
  expect(scale).toBeLessThan(1.05);
  animator.dispose();
});

test("requested and system motion preferences apply in Safari too", () => {
  // Browser detection runs at import time. A fresh process supplies Safari's
  // navigator before any module (including filter-budget) can be cached.
  const script = `
    Object.defineProperty(globalThis, "navigator", { value: { vendor: "Apple Computer, Inc.", userAgent: "Mozilla/5.0 AppleWebKit/605.1.15 Version/27.0 Safari/605.1.15" } });
    const query = { matches: false };
    globalThis.matchMedia = () => query;
    const { resolveMotion } = await import(${JSON.stringify(new URL("./interaction.ts", import.meta.url).href)});
    const result = [resolveMotion("full"), resolveMotion(undefined), resolveMotion("reduced"), resolveMotion("none")];
    query.matches = true;
    result.push(resolveMotion("full"), resolveMotion(undefined), resolveMotion("none"));
    console.log(JSON.stringify(result));
  `;
  const result = Bun.spawnSync([process.execPath, "--eval", script]);
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout.toString())).toEqual(["full", "full", "reduced", "none", "reduced", "reduced", "none"]);
});

test("a press keeps native link and image drags from taking over, unless content opts in", () => {
  const target = surface();
  const animator = attachInteraction(target.element, () => "full");
  const node = (draggable: boolean) => ({ nodeType: 1, closest: () => draggable ? {} : null });
  const dragFrom = (origin: object) => {
    let prevented = false;
    target.fire("dragstart", { target: origin, preventDefault: () => { prevented = true; } });
    return prevented;
  };
  expect(dragFrom(node(false))).toBe(false);
  target.fire("pointerdown", { button: 0, pointerId: 1, clientX: 20, clientY: 14 });
  expect(dragFrom(node(false))).toBe(true);
  expect(dragFrom({ nodeType: 3, parentElement: node(false) })).toBe(true);
  expect(dragFrom(node(true))).toBe(false);
  animator.dispose();
});
