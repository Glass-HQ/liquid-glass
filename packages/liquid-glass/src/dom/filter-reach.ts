import type { FilterBounds } from "./filter-bounds.js";

/** WebKit filters a partial repaint of an HTML element over the dirty rect
 * grown by the element's filter outsets, then grows that region by the
 * outsets again. A primitive whose subregion misses the region yields no
 * image, which fails the whole filter, so the repainted area paints blank:
 * hovering a link far from every lens erases it. The filter must reach
 * from any point of the element to every primitive it evaluates. */

/** Outsets, in user units, that let any repaint inside a `width` × `height`
 * element reach every primitive subregion of `markup` and every `extra` box. */
export function repaintReach(markup: string, width: number, height: number, extra: readonly FilterBounds[] = []): number {
  let gap = 0;
  const reach = (box: FilterBounds) => {
    gap = Math.max(gap, box.x, width - box.x - box.width, box.y, height - box.y - box.height);
  };
  for (const [tag] of markup.matchAll(/<fe\w+\b[^>]*>/g)) {
    const value = (name: string) => Number(new RegExp(`\\s${name}="([-\\d.e]+)"`).exec(tag)?.[1] ?? NaN);
    const box = { x: value("x"), y: value("y"), width: value("width"), height: value("height") };
    if (Object.values(box).every(Number.isFinite)) reach(box);
  }
  extra.forEach(reach);
  // Both growths count; round up so small moves keep the same markup.
  return gap > 0 ? Math.ceil((gap / 2 + 2) / 16) * 16 : 0;
}

/** Add `outsets` to the filter's last merge with transparent images that
 * only move pixels. As siblings in that merge they raise its outsets to at
 * least `outsets` instead of adding to the branches beside them.
 *
 * Offsets are cheap copies but stay within half the element, so their
 * shifted image always overlaps the region. A layer WebKit splits into tiles
 * filters each tile over the tile grown by its outsets once, which needs more
 * reach than that; `tiled` pads with blurs of a transparent flood instead,
 * whose outsets grow without moving anything. */
export function padRepaintReach(markup: string, outsets: number, width: number, height: number, tiled = false): string {
  const start = [...markup.matchAll(/<feMerge[\s>]/g)].at(-1)?.index ?? -1;
  if (start < 0 || outsets <= 0) return markup;
  const open = markup.indexOf(">", start) + 1;
  const box = `x="0" y="0" width="${width}" height="${height}"`;
  let pad = `<feFlood flood-opacity="0" ${box} result="reach"/>`, inputs: string[];
  if (tiled) {
    // WebKit caps a blur's kernel at 500 pixels, so chain blurs for more.
    let input = "reach", left = outsets, step = 0;
    while (left > 0) {
      const amount = Math.min(left, 700);
      pad += `<feGaussianBlur in="${input}" stdDeviation="${Math.ceil(amount / blurOutsetRatio)}" ${box} result="reach-${++step}"/>`;
      input = `reach-${step}`;
      left -= amount;
    }
    inputs = [input];
  } else {
    const dx = Math.min(outsets, Math.floor(width / 2)), dy = Math.min(outsets, Math.floor(height / 2));
    pad += `<feOffset in="reach" dx="${dx}" dy="${dy}" ${box} result="reach-after"/>`
      + `<feOffset in="reach" dx="${-dx}" dy="${-dy}" ${box} result="reach-before"/>`;
    inputs = ["reach-after", "reach-before"];
  }
  return markup.slice(0, start) + pad + markup.slice(start, open)
    + inputs.map((input) => `<feMergeNode in="${input}"/>`).join("") + markup.slice(open);
}
/** A tile grows its own rectangle by the outsets once rather than twice,
 * so it needs about twice the outsets of a whole-layer repaint. */
export const tiledReach = 2;
/** WebKit's outsets per unit of blur deviation: 3/2 of a kernel of 1.88 deviations. */
const blurOutsetRatio = 3 * 0.75 * Math.sqrt(2 * Math.PI) / 2;
