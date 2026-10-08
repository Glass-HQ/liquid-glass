import { expect, test } from "bun:test";
import { patchFilters } from "./filter-patch.js";
import { mapImage, surfaceMapResult } from "./map-image.js";
import type { MapPlane } from "./map-image.js";
import type { MaterialMaps } from "./maps.js";

/** A minimal DOM records mutations and ownership; SVG rasterization is
 * separately verified in browsers. There is deliberately no HTML parser. */
class ElementStub {
  readonly attributes = new Map<string, string>();
  readonly children: ElementStub[] = [];
  parentElement: ElementStub | null = null;
  writes = 0;
  connectedMoves = 0;
  isConnected = false;
  constructor(readonly ownerDocument: DocumentStub, readonly tagName: string) {}
  get id() { return this.attributes.get("id") ?? ""; }
  set id(value: string) { this.setAttribute("id", value); }
  get firstElementChild() { return this.children[0] ?? null; }
  get nextElementSibling(): ElementStub | null {
    const siblings = this.parentElement?.children;
    return siblings?.[siblings.indexOf(this) + 1] ?? null;
  }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); this.writes++; }
  removeAttribute(name: string) { this.attributes.delete(name); this.writes++; }
  append(element: ElementStub) { this.insertBefore(element, null); }
  insertBefore(element: ElementStub, before: ElementStub | null) {
    // Count an existing node moved out of an installed filter, separately
    // from its attributes or identity: insertBefore detaches it briefly.
    let ancestor = element.parentElement;
    while (ancestor && ancestor.tagName !== "defs") ancestor = ancestor.parentElement;
    if (ancestor) element.connectedMoves++;
    element.remove();
    const index = before ? this.children.indexOf(before) : this.children.length;
    if (index < 0) throw new Error("Insertion point is not a child");
    this.children.splice(index, 0, element);
    element.parentElement = this;
    this.writes++;
  }
  remove() {
    const parent = this.parentElement;
    if (parent) { parent.children.splice(parent.children.indexOf(this), 1); parent.writes++; }
    this.parentElement = null;
  }
  find(result: string): ElementStub | undefined {
    if (this.getAttribute("result") === result) return this;
    for (const child of this.children) { const found = child.find(result); if (found) return found; }
  }
  mutations(): number { return this.writes + this.children.reduce((sum, child) => sum + child.mutations(), 0); }
}
class DocumentStub {
  created = 0;
  createElementNS(_namespace: string, tag: string) { this.created++; return new ElementStub(this, tag); }
}
const scene = () => {
  const document = new DocumentStub();
  const defs = new ElementStub(document, "defs");
  const apply = (markup: string[]) => patchFilters(defs as unknown as Element, markup, (token) => `data:${token}`);
  return { document, defs, apply };
};
const filter = (contents: string, width = 1) => `<filter id="glass" x="0" y="0" width="${width}" height="1" filterUnits="objectBoundingBox">${contents}</filter>`;
const image = (result: string, token: string, x = 0) => `<feImage data-map="${token}" x="${x}" y="0" width="1" height="1" result="${result}"/>`;

test("moving maps retain elements and decoded image references; identical frames make no DOM writes", () => {
  const { document, defs, apply } = scene();
  const id = apply([filter(image("map", "m1"))])("glass");
  const map = defs.find("map")!;
  const created = document.created;
  const before = defs.mutations();
  expect(apply([filter(image("map", "m1"))])("glass")).toBe(id);
  expect(defs.mutations()).toBe(before);
  apply([filter(image("map", "m1", .25), 2)]);
  expect(defs.find("map")).toBe(map);
  expect(map.getAttribute("href")).toBe("data:m1");
  expect(map.getAttribute("x")).toBe("0.25");
  expect(document.created).toBe(created);
  expect(defs.children[0]!.id).toBe(id);
  apply([filter(image("map", "m2", .25), 2)]);
  expect(defs.find("map")).toBe(map);
  expect(map.getAttribute("href")).toBe("data:m2");
});

test("adding and reordering branches preserves existing images and merge nodes", () => {
  const { defs, apply } = scene();
  const merge = (inputs: string[]) => `<feMerge result="output">${inputs.map((input) => `<feMergeNode in="${input}"/>`).join("")}</feMerge>`;
  apply([filter(image("a", "m1") + merge(["a"]))]);
  const a = defs.find("a"), output = defs.find("output");
  apply([filter(image("b", "m2") + image("a", "m1") + merge(["b", "a"]))]);
  expect(defs.find("a")).toBe(a);
  expect(defs.find("output")).toBe(output);
  expect(output!.children.length).toBe(2);
  expect(defs.children[0]!.children.map((node) => node.getAttribute("result"))).toEqual(["a", "b", "output"]);
  expect(a!.connectedMoves).toBe(0);
  apply([filter(image("a", "m1") + merge(["a"]))]);
  expect(defs.find("b")).toBeUndefined();
  expect(defs.find("output")).toBe(output);
  expect(output!.children.length).toBe(1);
});

test("absorbing a group member and splitting the survivors retains every unchanged map image", () => {
  const { defs, apply } = scene();
  const planes: MapPlane[] = ["displacement", "mask", "highlight", "outline"];
  const maps = new Map([1, 2, 3].map((serial) => [serial, {
    ...Object.fromEntries(planes.map((plane) => [plane, `${serial}-${plane}`])),
    // Include a sliced capsule: all three feImages and its merge must survive.
    ...(serial === 3 ? { capsule: { cap: 8, height: 20, planes: Object.fromEntries(planes.map((plane) => [plane, ["L", "M", "R"].map((part) => `${serial}-${plane}-${part}`)])) } } : {}),
  } as MaterialMaps]));
  const branch = (members: number[]) => planes.map((plane) => {
    const images = members.map((serial) => mapImage(maps.get(serial)!, plane, surfaceMapResult(serial, plane), serial * 100, 0, 80, 20)).join("");
    if (members.length === 1) return images;
    return images + `<feMerge result="g${members.join("-")}${plane}">${members.map((serial) => `<feMergeNode in="${surfaceMapResult(serial, plane)}"/>`).join("")}</feMerge>`;
  }).join("");
  apply([filter(branch([1, 2, 3]))]);
  const names = planes.flatMap((plane) => [surfaceMapResult(2, plane), ...["L", "M", "R"].map((part) => `${surfaceMapResult(3, plane)}${part}`)]);
  const retained = names.map((name) => ({ name, node: defs.find(name)!, writes: defs.find(name)!.writes }));
  // A detaching menu absorbs its toolbar, then nearby geometry can split
  // the remaining group. Closing the menu restores the original membership.
  for (const units of [[[2, 3]], [[2], [3]], [[2, 3]], [[1, 2, 3]]]) {
    apply([filter(units.map(branch).join(""))]);
    for (const { name, node, writes } of retained) {
      expect(defs.find(name)).toBe(node);
      expect(node.getAttribute("href")).not.toBeNull();
      expect(node.writes).toBe(writes);
      expect(node.connectedMoves).toBe(0);
    }
  }
});

test("removing a leading image or replacing capsule slices never moves the surviving image", () => {
  const { defs, apply } = scene();
  const output = (inputs: string[]) => `<feMerge result="output">${inputs.map((input) => `<feMergeNode in="${input}"/>`).join("")}</feMerge>`;
  const plain = { displacement: "plain" } as MaterialMaps;
  const capsule = { displacement: "capsule", capsule: { cap: 8, height: 20, planes: { displacement: ["left", "middle", "right"] } } } as unknown as MaterialMaps;
  const moving = (maps: MaterialMaps) => mapImage(maps, "displacement", "a", 0, 0, 80, 20);
  apply([filter(moving(capsule) + image("z", "unchanged") + output(["a", "z"]))]);
  const survivor = defs.find("z")!;
  for (const maps of [plain, capsule, undefined, plain]) {
    apply([filter((maps ? moving(maps) : "") + image("z", "unchanged") + output(maps ? ["a", "z"] : ["z"]))]);
    expect(defs.find("z")).toBe(survivor);
    expect(survivor.connectedMoves).toBe(0);
    expect(survivor.getAttribute("href")).toBe("data:unchanged");
  }
});

test("implicit inputs and a final image retain SVG primitive order", () => {
  const { defs, apply } = scene();
  const cases = [
    // The transfer reads the preceding image; moving z before it would
    // change its input even though every node retained its own identity.
    image("a", "a") + '<feComponentTransfer result="changed"/>' + image("z", "z") + '<feMerge result="out"><feMergeNode in="changed"/><feMergeNode in="z"/></feMerge>',
    image("a", "a") + '<feBlend in="a" result="changed"/>' + image("z", "z") + '<feMerge result="out"><feMergeNode in="changed"/><feMergeNode in="z"/></feMerge>',
    image("a", "a") + '<feMerge result="changed"><feMergeNode/></feMerge>' + image("z", "z") + '<feMerge result="out"><feMergeNode in="changed"/><feMergeNode in="z"/></feMerge>',
    image("a", "a") + '<feColorMatrix in="a" result="changed"/>' + image("z", "z"),
  ];
  for (const contents of cases) {
    apply([filter(contents)]);
    const expected = [...contents.matchAll(/result="([^"]+)"/g)].map((match) => match[1]);
    expect(defs.children[0]!.children.map((node) => node.getAttribute("result"))).toEqual(expected);
  }
});

test("removed filters get fresh reference ids and stale attributes are removed", () => {
  const { defs, apply } = scene();
  const first = apply([filter('<feComposite result="out" operator="arithmetic" k2="1"/>')])("glass");
  apply([filter('<feComposite result="out" operator="in"/>')]);
  expect(defs.find("out")!.getAttribute("k2")).toBeNull();
  apply([]);
  expect(defs.children).toEqual([]);
  const second = apply([filter(image("map", "m1"))])("glass");
  expect(second).not.toBe(first);
});

test("duplicate primitive identities cannot leave a trailing tile as the filter output", () => {
  const { defs, apply } = scene();
  const tiles = '<feOffset in="SourceGraphic" result="edge"/><feTile in="edge" result="tile"/>';
  const output = '<feMerge result="output"><feMergeNode in="SourceGraphic"/><feMergeNode in="tile"/></feMerge>';
  apply([filter(tiles + output)]);
  const before = defs.mutations();
  expect(() => apply([filter(tiles + tiles + output)])).toThrow('Duplicate glass filter result "edge"');
  expect(defs.mutations()).toBe(before);
  expect(defs.children[0]!.children.map((node) => node.getAttribute("result"))).toEqual(["edge", "tile", "output"]);
});
