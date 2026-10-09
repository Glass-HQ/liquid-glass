import { webkit } from "./engine.js";
export { isWebKit, webkit } from "./engine.js";
/** WebKit paints CSS reference filters in software and adds up the outsets of
 * every blur and displacement primitive in an element's filters: along a
 * chain of `url()` filters, and across the branches of one filter's graph,
 * whose walk folds only one level at a time and sums what it leaves behind.
 * It then clamps the whole filter buffer to 4096 × 4096 device pixels, and
 * past that clamp draws the result stretched, so glass lands away from its
 * surface. Keeping the sum of outsets inside the budget keeps the geometry
 * exact; the material only softens on scenes that would otherwise overflow. */
/** Outsets WebKit charges for one Gaussian blur of this sigma, in the blur's own pixels. */
export const blurOutsets = (sigma: number): number => 3 * (sigma * 0.75 * Math.sqrt(2 * Math.PI)) / 2;
const limit = 4096 * 4096 * 0.9;
/** Factor to apply to every blur sigma and displacement amount so a filtered
 * box of `width` × `height` device pixels with `outsets` device pixels of
 * accumulated outsets stays inside WebKit's buffer clamp. 1 when it already fits. */
export function filterBudgetFactor(width: number, height: number, outsets: number): number {
  if (!webkit || outsets <= 0 || (width + 2 * outsets) * (height + 2 * outsets) <= limit) return 1;
  return Math.max(0.1, Math.min(1, outsetBudget(width, height) / outsets));
}

/** Largest outsets, in device pixels, a `width` × `height` device-pixel box can take before the clamp. */
export function outsetBudget(width: number, height: number): number {
  return Math.max(0, (-(width + height) + Math.sqrt((width + height) ** 2 - 4 * (width * height - limit))) / 4);
}

/** Mirror WebKit's depth-first outset fold. Shared inputs are visited again
 * at each use, so counting each blur once underestimates branched graphs. */
export function filterGraphOutsets(markup: string, width = 1, height = width): number {
  type Node = { inputs: string[]; outset: number };
  const nodes = new Map<string, Node>();
  let last: Node | undefined;
  for (const match of markup.matchAll(/<(fe\w+)\b([^>]*?)(?:\/>|>(.*?)<\/\1>)/gs)) {
    const [, tag, attrs = "", children = ""] = match;
    const attributes = Object.fromEntries([...attrs.matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1]!, a[2]!]));
    const inputs = tag === "feMerge" ? [...children.matchAll(/in="([^"]+)"/g)].map((a) => a[1]!)
      : [attributes.in, attributes.in2].filter((name): name is string => Boolean(name));
    const deviation = (attributes.stdDeviation ?? "0").split(" ").map(Number);
    const sigma = Math.max(deviation[0]! * width, (deviation[1] ?? deviation[0]!) * height);
    const outset = tag === "feGaussianBlur" && sigma > 0
      ? Math.floor(3 * Math.min(500, Math.max(2, Math.floor(sigma * .75 * Math.sqrt(2 * Math.PI) + .5))) / 2)
      : tag === "feDisplacementMap" ? Math.ceil(Math.abs(Number(attributes.scale ?? 0)) * Math.max(width, height) / 2)
      : tag === "feOffset" ? Math.ceil(Math.max(Math.abs(Number(attributes.dx ?? 0)) * width, Math.abs(Number(attributes.dy ?? 0)) * height)) : 0;
    last = { inputs, outset };
    if (attributes.result) nodes.set(attributes.result, last);
  }
  if (!last) return 0;
  const stack: { outset: number; depth: number }[] = [];
  const fold = () => {
    const depth = stack.at(-1)!.depth;
    let outset = 0;
    while (stack.length && stack.at(-1)!.depth === depth) outset = Math.max(outset, stack.pop()!.outset);
    return outset;
  };
  const visit = (node: Node, depth: number) => {
    if (stack.length && depth < stack.at(-1)!.depth) { const children = fold(); stack.at(-1)!.outset += children; }
    stack.push({ outset: node.outset, depth });
    for (const name of node.inputs) { const child = nodes.get(name); if (child) visit(child, depth + 1); }
  };
  visit(last, 0);
  while (stack.length > 1) { const children = fold(); stack.at(-1)!.outset += children; }
  return stack[0]!.outset;
}
