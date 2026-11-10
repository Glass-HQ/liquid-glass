import { filterGraphOutsets } from "./filter-budget.js";
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

/** Raise repaint reach with a transparent branch in the last merge.
 *
 * WebKit charges a displacement `scale / 2` of outsets wherever its region
 * is, and an image whose region misses the repaint fails the whole filter.
 * Every primitive region is in reach of any repaint, so a one-pixel seed
 * inside one of them always yields an image, and displacing it by a map
 * with no coverage keeps it transparent. Two one-pixel primitives reach as
 * far as any full-size padding, which software filters fill on every render.
 * Without such a region, a transparent flood covers the element instead. */
export function padRepaintReach(markup: string, outsets: number, width: number, height: number, naturalOutsets?: number): string {
  const start = [...markup.matchAll(/<feMerge[\s>]/g)].at(-1)?.index ?? -1;
  if (start < 0 || outsets <= 0) return markup;
  const open = markup.indexOf(">", start) + 1;
  const natural = naturalOutsets ?? filterGraphOutsets(markup);
  // A pixel of an existing region is in reach of any repaint; so is the
  // element's center once the reach spans half of it from every side.
  const seed = seedPoint(markup, width, height)
    ?? (2 * outsets >= Math.max(width, height) / 2 + 1 ? { x: Math.floor(Math.max(0, width - 1) / 2), y: Math.floor(Math.max(0, height - 1) / 2) } : undefined);
  const build = (reach: number) => {
    const scale = 2 * Math.ceil(reach);
    if (!seed) {
      // Opposed offsets of a flood over the element, each within half of it,
      // keep overlapping the repaint wherever it is.
      const box = `x="0" y="0" width="${width}" height="${height}"`;
      const dx = Math.min(reach, Math.floor(width / 2)), dy = Math.min(reach, Math.floor(height / 2));
      return markup.slice(0, start) + `<feFlood flood-opacity="0" ${box} result="reach-seed"/>`
        + `<feOffset in="reach-seed" dx="${dx}" dy="${dy}" ${box} result="reach-after"/><feOffset in="reach-seed" dx="${-dx}" dy="${-dy}" ${box} result="reach-before"/>`
        + markup.slice(start, open) + `<feMergeNode in="reach-after"/><feMergeNode in="reach-before"/>` + markup.slice(open);
    }
    const pad = `<feFlood flood-opacity="0" x="${seed.x}" y="${seed.y}" width="1" height="1" result="reach-seed"/>`
      + `<feDisplacementMap in="reach-seed" in2="reach-seed" scale="${scale}" x="${seed.x}" y="${seed.y}" width="1" height="1" result="reach"/>`;
    return markup.slice(0, start) + pad + markup.slice(start, open) + `<feMergeNode in="reach"/>` + markup.slice(open);
  };
  // WebKit's fold can add the reach to the graph's own outsets instead of
  // taking the larger; ask only for the difference when that still suffices.
  const smaller = natural > 0 && natural < outsets ? build(outsets - natural) : undefined;
  return smaller && filterGraphOutsets(smaller) >= outsets ? smaller : build(outsets);
}

/** A pixel inside the first primitive region that lies within the element. */
function seedPoint(markup: string, width: number, height: number): { x: number; y: number } | undefined {
  for (const [tag] of markup.matchAll(/<fe\w+\b[^>]*>/g)) {
    const value = (name: string) => Number(new RegExp(`\\s${name}="([-\\d.e]+)"`).exec(tag)?.[1] ?? NaN);
    const x = value("x"), y = value("y"), w = value("width"), h = value("height");
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) continue;
    if (x < 0 || y < 0 || x + w > width || y + h > height) continue;
    return { x: Math.floor(x + Math.min(w, 1) / 2), y: Math.floor(y + Math.min(h, 1) / 2) };
  }
  return undefined;
}

/** A tile grows its own rectangle by the outsets once rather than twice,
 * so it needs about twice the outsets of a whole-layer repaint. */
export const tiledReach = 2;
