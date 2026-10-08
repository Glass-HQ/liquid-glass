import { expect, test } from "bun:test";
import { compoundFieldImage, compoundSources, fieldTouches } from "./compound-field.js";
import type { MaterialOptions } from "../core/materials.js";
import type { MapPlane } from "./map-image.js";

const surface = (serial: number, x = serial * 300) => ({
  serial, element: {} as Element, x, y: 0, w: 80, h: 40, maps: {}, opacity: 1, baseOpacity: 1,
  options: { material: "regular", appearance: "light", refraction: 60 } as MaterialOptions,
  source: undefined as Element | undefined, nested: false, reach: 140,
});
type Surface = ReturnType<typeof surface>;
const context = {
  source: (s: Surface) => s.source, nested: (s: Surface) => s.nested,
  refraction: (s: Surface) => s.options.refraction ?? 60, reach: (s: Surface) => s.reach,
};
const pair = () => {
  const source = surface(1), popup = surface(2);
  popup.source = source.element;
  return { source, popup };
};

test("a detached pair keeps its field when absorbed source opacity falls to zero", () => {
  const { source, popup } = pair();
  for (const opacity of [1, .3, 0, .3, 1]) {
    source.opacity = opacity;
    expect(compoundSources([source, popup], context).get(popup)).toBe(source);
  }
});

test("different material, appearance, tint, refraction, authored opacity or nesting keeps separate fields", () => {
  const changes: ((s: Surface) => void)[] = [
    (s) => { s.options.material = "clear"; }, (s) => { s.options.appearance = "dark"; },
    (s) => { s.options.tint = "#123456"; }, (s) => { s.options.refraction = 61; },
    (s) => { s.baseOpacity = .8; }, (s) => { s.nested = true; },
  ];
  for (const target of ["source", "popup"] as const) for (const change of changes) {
    const p = pair(); change(p[target]);
    expect(compoundSources([p.source, p.popup], context).size).toBe(0);
  }
});

test("intervening glass uses both read reaches and real member boxes", () => {
  const { source, popup } = pair();
  const other = surface(3, source.x + source.w + 150);
  source.reach = 20; other.reach = 200;
  expect(compoundSources([source, other, popup], context).size).toBe(0);
  other.reach = 20;
  expect(compoundSources([source, other, popup], context).get(popup)).toBe(source);
  // Glass in a wide field's empty gap is not a backdrop dependency.
  popup.x = source.x + 1000;
  other.x = source.x + 500;
  expect([source, popup].some((member) => fieldTouches(other, member, 60))).toBe(false);
  other.x = popup.x - 20;
  expect([source, popup].some((member) => fieldTouches(other, member))).toBe(true);
});

test("simultaneous claims, chained popups and reversed paint order do not share a source", () => {
  const { source, popup } = pair();
  const second = surface(3); second.source = source.element;
  expect(compoundSources([source, popup, second], context).size).toBe(0);
  second.source = popup.element;
  expect(compoundSources([source, popup, second], context).size).toBe(0);
  expect(compoundSources([popup, source], context).size).toBe(0);
});

type Pixel = [number, number, number, number];
const premultiply = ([r, g, b, a]: Pixel): Pixel => [r * a, g * a, b * a, a];
const scale = (p: Pixel, a: number) => p.map((v) => v * a) as Pixel;
const over = (top: Pixel, bottom: Pixel) => top.map((v, i) => v + bottom[i]! * (1 - top[3])) as Pixel;
const attrs = (markup: string) => Object.fromEntries([...markup.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
/** Evaluate the emitted SVG subset with premultiplied pixels. Inputs are
 * independently chosen map and coverage pixels, including transparent edges. */
function pixels(markup: string, images: Record<string, Pixel>): Map<string, Pixel> {
  const values = new Map<string, Pixel>();
  for (const match of markup.matchAll(/<(feImage|feComponentTransfer|feComposite|feMerge)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g)) {
    const [, tag, attributes, children = ""] = match, a = attrs(attributes!);
    const input = () => values.get(a.in!)!;
    let result: Pixel;
    if (tag === "feImage") result = premultiply(images[a.href!]!);
    else if (tag === "feMerge") {
      result = [0, 0, 0, 0];
      for (const node of children.matchAll(/<feMergeNode\s+([^>]+)\/>/g)) result = over(values.get(attrs(node[1]!).in!)!, result);
    } else if (tag === "feComposite") {
      const alpha = values.get(a.in2!)![3];
      result = scale(input(), a.operator === "in" ? alpha : 1 - alpha);
    } else {
      const pixel = input(), alpha = attrs(children), next = pixel[3] * Number(alpha.slope ?? 1) + Number(alpha.intercept ?? 0);
      result = [...pixel.slice(0, 3).map((v) => pixel[3] ? v / pixel[3] * next : 0), next] as Pixel;
    }
    values.set(a.result!, result);
  }
  return values;
}
const planes: MapPlane[] = ["displacement", "mask", "outline", "highlight"];
function field(weight: number, coverage: [number, number], mapAlpha = 1) {
  const source = { serial: 1, opacity: weight, baseOpacity: 1 }, popup = { serial: 2, opacity: 1 };
  const images: Record<string, Pixel> = {
    "1-displacement": [.6, .4, .5, 1], "2-displacement": [.2, .8, .5, mapAlpha],
    "1-mask": [1, 1, 1, coverage[0]], "2-mask": [1, 1, 1, coverage[1]],
    "1-outline": [0, 0, 0, .5], "2-outline": [0, 0, 0, .2],
    "1-highlight": [1, 1, 1, .5], "2-highlight": [1, 1, 1, .2],
  };
  const markup = planes.map((plane) => compoundFieldImage(source, popup, plane, plane, { x: 0, y: 0, width: 200, height: 100 },
    (member, selected, result) => `<feImage href="${member.serial}-${selected}" result="${result}"/>`)).join("");
  return { markup, values: pixels(markup, images) };
}

test("field maps use actual masks and preserve coverage through absorption and antialiased edges", () => {
  for (const [weight, sourceCoverage, popupCoverage, mapAlpha] of [
    [0, 1, .6, 1], [1, 1, 0, 0], [1, 0, 1, 1], [1, 0, 0, 0], [.7, 1, .3, .3], [.7, .6, .25, .4],
  ] as const) {
    const { values, markup } = field(weight, [sourceCoverage, popupCoverage], mapAlpha);
    expect(markup).toContain('href="1-mask" result="s1mask"');
    expect(markup).toContain('href="2-mask" result="s2mask"');
    const expected = popupCoverage + sourceCoverage * weight * (1 - popupCoverage);
    const map = values.get("displacement")!, mask = values.get("mask")!;
    expect(mask[3]).toBeCloseTo(expected, 10);
    expect(map[3]).toBeCloseTo(expected, 10);
    if (expected) {
      // Neutral blue stays neutral after unpremultiplication, including
      // where the popup's raw map alpha differs from its shape coverage.
      expect(map[2] / map[3]).toBeCloseTo(.5, 10);
      expect(map[0] / map[3]).toBeCloseTo((.2 * popupCoverage + .6 * sourceCoverage * weight * (1 - popupCoverage)) / expected, 10);
    } else expect(map).toEqual([0, 0, 0, 0]);
  }
});

test("source rim and light retain their old attenuation below popup material", () => {
  const { values } = field(.6, [1, .4]);
  const expected = .2 + .5 * .6 * (1 - .4) * (1 - .2);
  expect(values.get("outline")![3]).toBeCloseTo(expected, 10);
  expect(values.get("highlight")![3]).toBeCloseTo(expected, 10);
});
