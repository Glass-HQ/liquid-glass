import { expect, test } from "bun:test";
import { composeSparseLayers } from "./compose-layers.js";
import type { SparseCompositionUnit } from "./compose-layers.js";
import type { FilterBounds } from "./filter-bounds.js";

type Pixel = [number, number, number, number];
const transparent: Pixel = [0, 0, 0, 0];
const rgba = (r: number, g: number, b: number, alpha: number): Pixel => [r * alpha, g * alpha, b * alpha, alpha];
const scale = (pixel: Pixel, factor: number) => pixel.map((channel) => channel * factor) as Pixel;
const over = (front: Pixel, back: Pixel) => front.map((channel, index) => channel + back[index]! * (1 - front[3])) as Pixel;
const contains = (bounds: FilterBounds, x: number, y: number) => x >= bounds.x && x < bounds.x + bounds.width && y >= bounds.y && y < bounds.y + bounds.height;
const attributes = (markup: string) => Object.fromEntries([...markup.matchAll(/([\w-]+)="([^"]*)"/g)].map((match) => [match[1]!, match[2]!]));

/** Interpret only the generated compositing primitives at one pixel, with
 * SVG's premultiplied RGBA, source-over merge order and primitive clipping. */
function evaluate(markup: string, inputs: Record<string, Pixel>, x = 5, y = 5): Pixel {
  const values = new Map(Object.entries(inputs));
  let last = transparent;
  for (const tag of markup.matchAll(/<feMerge\b([^>]*)>(.*?)<\/feMerge>|<feComposite\b([^>]*)\/>|<feFlood\b([^>]*)\/>/gs)) {
    const a = attributes(tag[1] ?? tag[3] ?? tag[4]!);
    const read = (name: string) => {
      const pixel = values.get(name);
      if (!pixel) throw new Error(`Unknown filter input: ${name}`);
      return pixel;
    };
    if (tag[1] !== undefined) {
      last = [...tag[2]!.matchAll(/<feMergeNode in="([^"]+)"\/>/g)].reduce((back, node) => over(read(node[1]!), back), transparent);
    } else if (tag[4] !== undefined) {
      last = [1, 1, 1, 1];
    } else {
      const first = read(a.in!), second = read(a.in2!);
      if (a.operator === "in") last = scale(first, second[3]);
      else if (a.operator === "out") last = scale(first, 1 - second[3]);
      else if (a.operator === "arithmetic") {
        last = first.map((channel, index) => Math.max(0, Math.min(1,
          Number(a.k1 ?? 0) * channel * second[index]! + Number(a.k2 ?? 0) * channel
          + Number(a.k3 ?? 0) * second[index]! + Number(a.k4 ?? 0)))) as Pixel;
      } else throw new Error(`Unexpected composite operator: ${a.operator}`);
    }
    if (a.x !== undefined && !contains({ x: +a.x, y: +a.y!, width: +a.width!, height: +a.height! }, x, y)) last = transparent;
    values.set(a.result!, last);
  }
  return last;
}

function sequential(units: readonly SparseCompositionUnit[], inputs: Record<string, Pixel>, x = 5, y = 5): Pixel {
  return units.reduce((previous, unit) => {
    if (!contains(unit.bounds, x, y)) return previous;
    const outside = scale(previous, 1 - inputs[unit.mask]![3]);
    return unit.layers.reduce((back, layer) => over(inputs[layer]!, back), outside);
  }, inputs.SourceGraphic!);
}
function unit(id: string, bounds: FilterBounds = { x: 0, y: 0, width: 20, height: 20 }): SparseCompositionUnit {
  return { id, mask: `${id}mask`, layers: [`${id}inside`, `${id}outline`, `${id}light`], bounds };
}
function close(actual: Pixel, expected: Pixel) {
  actual.forEach((channel, index) => expect(channel).toBeCloseTo(expected[index]!, 12));
}
function pixels(units: readonly SparseCompositionUnit[], sourceAlpha: number, seed: number): Record<string, Pixel> {
  const inputs: Record<string, Pixel> = { SourceGraphic: rgba(.12, .7, .3, sourceAlpha) };
  const levels = [0, .02, .25, .5, .95, 1];
  units.forEach((current, index) => {
    const mask = levels[(seed + index) % levels.length]!;
    inputs[current.mask] = rgba(1, 1, 1, mask);
    // Material alpha need not equal mask alpha: the sampled source can be
    // transparent. Outline and highlight may also extend beyond that mask.
    inputs[current.layers[0]!] = rgba(.8, .2, .1, mask * levels[(seed * 3 + index + 2) % levels.length]!);
    inputs[current.layers[1]!] = rgba(.05, .2, .9, levels[(seed * 2 + index + 1) % levels.length]!);
    inputs[current.layers[2]!] = rgba(1, .8, .4, levels[(seed + index + 3) % levels.length]!);
  });
  return inputs;
}

test("an empty composition preserves transparent source pixels", () => {
  const inputs = { SourceGraphic: rgba(.2, .8, .5, .3) };
  close(evaluate(composeSparseLayers([]), inputs), inputs.SourceGraphic);
});

test("sparse replacement matches sequential composition through partial masks and transparent materials", () => {
  for (const count of [1, 2, 4]) {
    const units = Array.from({ length: count }, (_, index) => unit(`u${index}`));
    const markup = composeSparseLayers(units);
    for (const alpha of [0, .1, .5, 1]) for (let seed = 0; seed < 6; seed++) {
      const inputs = pixels(units, alpha, seed);
      close(evaluate(markup, inputs), sequential(units, inputs));
    }
  }
});

test("later outline alpha occludes earlier layers even outside the later material mask", () => {
  const units = [unit("low"), unit("high")];
  const inputs: Record<string, Pixel> = {
    SourceGraphic: rgba(0, 1, 0, .4),
    lowmask: rgba(1, 1, 1, .6), lowinside: rgba(1, 0, 0, .2), lowoutline: transparent, lowlight: transparent,
    highmask: transparent, highinside: transparent, highoutline: rgba(0, 0, 1, .35), highlight: rgba(1, 1, 1, .1),
  };
  close(evaluate(composeSparseLayers(units), inputs), sequential(units, inputs));
  // The old source-over shortcut leaves the sharp source under the glass.
  const shortcut = units.reduce((back, current) => current.layers.reduce((previous, layer) => over(inputs[layer]!, previous), back), inputs.SourceGraphic!);
  expect(shortcut[1]).not.toBeCloseTo(sequential(units, inputs)[1], 6);
});

test("bounds culling preserves paint order and alpha across disconnected and transitive overlaps", () => {
  const units = [
    unit("a", { x: 0, y: 0, width: 20, height: 20 }),
    unit("b", { x: 30, y: 0, width: 20, height: 20 }),
    unit("bridge", { x: 10, y: 0, width: 30, height: 20 }),
    unit("far", { x: 200, y: 0, width: 20, height: 20 }),
    unit("touching", { x: 220, y: 0, width: 20, height: 20 }),
  ];
  const markup = composeSparseLayers(units);
  for (const x of [-1, 0, 9.5, 10, 19.99, 20, 30, 39.99, 40, 49.99, 50, 205, 220, 239.99, 240]) {
    const inputs = pixels(units, .45, 5);
    for (const current of units) if (!contains(current.bounds, x, 5)) {
      inputs[current.mask] = transparent;
      current.layers.forEach((layer) => { inputs[layer] = transparent; });
    }
    close(evaluate(markup, inputs, x), sequential(units, inputs, x));
  }
  expect(markup).not.toContain('result="scene-far-occlusion"');
  expect(markup).not.toContain('result="scene-touching-occlusion"');
  const fullComposites = [...markup.matchAll(/<feComposite\b([^>]*)\/>/g)].filter((tag) => !/\sx="/.test(tag[1]!));
  // Only the source cut-out covers the scene; the final merge draws over it.
  expect(fullComposites).toHaveLength(1);
  expect(markup).not.toContain('operator="arithmetic"');
  expect(markup.match(/<feFlood/g)).toHaveLength(3);
  expect(markup).toContain('result="scene-group0-area"');

});

test("a shared unit retains its full union bounds, including distant member pixels", () => {
  const shared = unit("shared", { x: -2, y: -2, width: 104, height: 24 });
  const markup = composeSparseLayers([shared]);
  expect(markup).toContain('<feMerge result="scene-shared-output" x="-2" y="-2" width="104" height="24">');
  const inputs = pixels([shared], .5, 2);
  close(evaluate(markup, inputs, 99), sequential([shared], inputs, 99));
});
