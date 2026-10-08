import { expect, test } from "bun:test";
import { createProgressiveLayer } from "./progressive.js";

test("scroll edges own only the target, preserve existing filters and release replaced targets", () => {
  const oldDocument = globalThis.document;
  const oldMedia = globalThis.matchMedia;
  const attached = new Set<unknown>();
  const doc = {
    body: { append: (node: unknown) => attached.add(node) },
    createElementNS: () => {
      const node = { style: {}, setAttribute() {}, replaceChildren() {}, remove: () => attached.delete(node) };
      return node;
    },
  };
  globalThis.document = doc as unknown as Document;
  // Exercise registration and cleanup without requiring a GPU in unit tests.
  globalThis.matchMedia = (() => ({ matches: true })) as typeof matchMedia;
  const root = { ownerDocument: doc, dataset: {} } as unknown as HTMLElement;
  let reads = 0;
  const makeTarget = () => ({
    get parentElement() { throw new Error("Scroll edges must not touch the parent"); },
    get style() { reads++; return style; },
  }) as unknown as HTMLElement;
  const style = { filter: "opacity(0.9)" };
  let target: HTMLElement | null = makeTarget();
  let layer: ReturnType<typeof createProgressiveLayer> | undefined;
  try {
    layer = createProgressiveLayer(root, (error) => { throw error; });
    const remove = layer.addScroll({ target: () => target });
    layer.update(null);
    expect(reads).toBeGreaterThan(0);
    expect(style.filter).toBe("opacity(0.9)");
    expect(attached.size).toBe(2);
    target = makeTarget();
    layer.update(null);
    expect(attached.size).toBe(2);
    target = null;
    layer.update(null);
    expect(attached.size).toBe(1);
    remove();
    layer.dispose();
    expect(attached.size).toBe(0);
    expect(style.filter).toBe("opacity(0.9)");
  } finally {
    layer?.dispose();
    globalThis.document = oldDocument;
    globalThis.matchMedia = oldMedia;
  }
});
