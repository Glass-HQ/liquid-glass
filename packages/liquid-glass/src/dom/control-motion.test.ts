import { expect, test } from "bun:test";
import { attachNativeControlMotion, updateControlMotion } from "./control-motion.js";

test("optical sampling sees the spring position before paint, once per frame", () => {
  const observer = globalThis.MutationObserver;
  globalThis.MutationObserver = class {
    observe() {}
    disconnect() {}
  } as unknown as typeof MutationObserver;
  const callbacks = new Map<number, FrameRequestCallback>();
  let id = 0, layoutX = 100;
  const style = {
    translate: "",
    setProperty() {},
    removeProperty() {},
  };
  const view = {
    requestAnimationFrame: (callback: FrameRequestCallback) => { callbacks.set(++id, callback); return id; },
    cancelAnimationFrame: (key: number) => { callbacks.delete(key); },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    addEventListener() {}, removeEventListener() {},
  };
  const element = {
    ownerDocument: { defaultView: view },
    classList: { contains: (name: string) => name === "lg-switch-thumb" },
    dataset: { pressPhase: "idle" },
    parentElement: null,
    style,
    getBoundingClientRect: () => ({ left: layoutX + (parseFloat(style.translate) || 0), width: 0 }),
  } as unknown as HTMLElement;
  const root = { contains: (candidate: HTMLElement) => candidate === element } as HTMLElement;
  let dispose: (() => void) | undefined;
  try {
    dispose = attachNativeControlMotion(element, "full", true);
    updateControlMotion(root, 100);
    layoutX = 118; // React commits the other side before the next scene frame.
    updateControlMotion(root, 116.667);
    const sampledX = element.getBoundingClientRect().left;
    expect(sampledX).toBeGreaterThan(100);
    expect(sampledX).toBeLessThan(102);
    // The scene's scheduled callback must not advance the thumb again after sampling.
    updateControlMotion(root, 116.667);
    expect(element.getBoundingClientRect().left).toBe(sampledX);
    expect(callbacks.size).toBe(1);
    const [key, callback] = [...callbacks][0]!;
    callbacks.delete(key);
    callback(133.334);
    const nextX = element.getBoundingClientRect().left;
    updateControlMotion(root, 133.334);
    expect(element.getBoundingClientRect().left).toBe(nextX);
    expect(nextX).toBeGreaterThan(sampledX);
    dispose(); dispose = undefined;
    expect(callbacks.size).toBe(0);
  } finally {
    dispose?.();
    globalThis.MutationObserver = observer;
  }
});
