import { expect, test } from "bun:test";
import { backdropGlassFilter, backdropGlassShadow } from "./backdrop-glass.js";
import { encodeMapPixels } from "./map-encoding.js";
import { nineMapImage } from "./map-image.js";
import type { MaterialMaps } from "./maps.js";

const tile = (plane: string, index: number) => `data:image/png;base64,${plane}${index}`;
const maps = (nine = true): MaterialMaps => ({
  field: "data:image/png;base64,field",
  rim: "data:image/png;base64,rim",
  light: "data:image/png;base64,light",
  duration: 0,
  ...(nine
    ? {
        nine: {
          x: 40,
          y: 40,
          planes: {
            field: Array.from({ length: 9 }, (_, i) => tile("field", i)),
            rim: Array.from({ length: 9 }, (_, i) => tile("rim", i)),
            light: Array.from({ length: 9 }, (_, i) => tile("light", i)),
          },
        },
      }
    : {}),
});
const glass = (options = {}, nine = true) =>
  backdropGlassFilter({
    id: "f",
    maps: maps(nine),
    options: { material: "regular", appearance: "dark", floating: true, ...options },
    width: 240,
    height: 300,
    size: 240,
    refraction: 60,
    backed: true,
    pixel: 0.5,
  });

/** How many times Chromium runs each pass, since it runs a pass once for
 * every pass that reads it, as if the graph were a tree. */
function expanded(markup: string) {
  const nodes = [...markup.matchAll(/<(fe\w+)\b([^>]*?)(\/?)>/g)].map(([, tag, attributes]) => ({
    tag: tag!,
    in: /\bin="([^"]+)"/.exec(attributes!)?.[1],
    in2: /\bin2="([^"]+)"/.exec(attributes!)?.[1],
    result: /\bresult="([^"]+)"/.exec(attributes!)?.[1],
  }));
  // Merge nodes read their children's inputs.
  const merged: { tag: string; inputs: string[]; result?: string }[] = [];
  for (const node of nodes) {
    if (node.tag === "feMergeNode") merged[merged.length - 1]!.inputs.push(node.in!);
    else
      merged.push({
        tag: node.tag,
        inputs: [node.in, node.in2].filter((n): n is string => Boolean(n)),
        result: node.result,
      });
  }
  const counts: Record<string, number> = {};
  const visit = (index: number) => {
    const node = merged[index]!;
    counts[node.tag] = (counts[node.tag] ?? 0) + 1;
    for (const input of node.inputs) {
      const from = merged.findLastIndex((n, i) => i < index && n.result === input);
      if (from >= 0) visit(from);
    }
  };
  visit(merged.length - 1);
  return counts;
}

test("backdrop glass reads each map image few times and refracts once", () => {
  const markup = glass();
  expect(markup.match(/<feImage /g)).toHaveLength(27);
  const counts = expanded(markup);
  expect(counts.feDisplacementMap).toBe(1);
  // The field is read by the refraction and two masks, the rim by the
  // outline and the ring, the light once: six reads of nine tiles.
  expect(counts.feImage).toBe(54);
});

test("backdrop glass draws the shape a device pixel inside its box", () => {
  const markup = glass();
  expect(markup).toContain('x="-1.5" y="-1.5" width="40" height="40"');
  expect(markup).toMatch(/<filter id="f" x="0" y="0" width="1" height="1"/);
  // Every pass but the map tiles works on the box.
  for (const [, tag, attributes] of markup.matchAll(/<(fe(?!Image|MergeNode|Func)\w+)\b([^>]*)>/g))
    if (!/result="g(field|rim|light)[^"]*"/.test(attributes!))
      expect([tag, attributes]).toEqual([tag, expect.stringContaining('width="240"')]);
});

test("backdrop glass without cut maps places whole planes", () => {
  expect(glass({}, false).match(/<feImage /g)).toHaveLength(3);
});

test("frost as soft as the fill skips the blend that would change nothing", () => {
  expect(glass()).not.toContain("feBlend");
  expect(glass({ floating: false, appearance: "light" })).toContain("feGaussianBlur");
});

test("the box shadow follows the material and nesting", () => {
  expect(backdropGlassShadow({ material: "regular", floating: true }, 200, false)).toBe(
    "0 10px 48px rgba(0, 0, 0, 0.18)",
  );
  expect(backdropGlassShadow({ material: "regular", floating: true }, 200, true)).toBe("");
  expect(backdropGlassShadow({ material: "clear" }, 200, false)).toBe("");
});

test("nine tiles place corners at their size and stretch the strips", () => {
  const markup = nineMapImage(maps(), "field", "r", 0, 0, 200, 100);
  const placed = [
    ...markup.matchAll(
      /<feImage [^>]*x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g,
    ),
  ].map((m) => m.slice(1).map(Number));
  expect(placed).toEqual([
    [0, 0, 40, 40],
    [40, 0, 120, 40],
    [160, 0, 40, 40],
    [0, 40, 40, 20],
    [40, 40, 120, 20],
    [160, 40, 40, 20],
    [0, 60, 40, 40],
    [40, 60, 120, 40],
    [160, 60, 40, 40],
  ]);
  // Tiles are added, so the pixel two fractional edges share is whole.
  expect(markup).not.toContain("feMerge");
  expect(markup.match(/operator="arithmetic" k1="0" k2="1" k3="1"/g)).toHaveLength(8);
  expect(markup).toContain('result="r"/>');
  // A box narrower than two corners squeezes them and drops the middle.
  expect(nineMapImage(maps(), "field", "r", 0, 0, 60, 100).match(/<feImage /g)).toHaveLength(6);
});

test("the encoder cuts each plane into corners and one-pixel strips", async () => {
  const width = 10,
    height = 8;
  const pixels = new Uint8Array(width * height * 3 * 4).map((_, i) => i % 251);
  const planes = await encodeMapPixels(pixels, width, height, undefined, { x: 3, y: 2 });
  expect(planes).toHaveLength(3);
  const size = (url: string) => {
    const bytes = Buffer.from(url.split(",")[1]!, "base64");
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  };
  expect(planes[0]!.map(size)).toEqual([
    [10, 8],
    [3, 2],
    [1, 2],
    [3, 2],
    [3, 1],
    [1, 1],
    [3, 1],
    [3, 2],
    [1, 2],
    [3, 2],
  ]);
});
