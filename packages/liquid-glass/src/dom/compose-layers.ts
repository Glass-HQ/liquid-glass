import { boundsMeet as intersects } from "./filter-bounds.js";
import type { FilterBounds } from "./filter-bounds.js";
import { unionSamplingBounds } from "./sampling-bounds.js";

export interface SparseCompositionUnit {
  /** Stable identity of this material unit. */
  id: string;
  mask: string;
  /** Material, outline and light, in their source-over paint order. */
  layers: readonly string[];
  /** Union of every member's output bounds, including outline padding. */
  bounds: FilterBounds;
  /** Each member's output bounds, when the unit shares one branch between
   * surfaces apart: only these boxes need to be composed with their
   * neighbors, rather than everything inside the union. */
  parts?: readonly FilterBounds[];
}

const region = (box: FilterBounds) => `x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}"`;
/** Whole-pixel rectangles have no partially covered edges, so the retained
 * source and the replaced regions never share a pixel. */
const snap = (box: FilterBounds): FilterBounds => {
  const x = Math.floor(box.x), y = Math.floor(box.y);
  return { x, y, width: Math.ceil(box.x + box.width) - x, height: Math.ceil(box.y + box.height) - y };
};
const merge = (inputs: readonly string[], result: string, bounds?: FilterBounds) =>
  `<feMerge result="${result}"${bounds ? ` ${region(bounds)}` : ""}>${inputs.map((input) => `<feMergeNode in="${input}"/>`).join("")}</feMerge>`;

/** Replace the source in disjoint rectangular regions. Each region keeps
 * the exact sequential alpha composition, but its intermediate buffers only
 * cover nearby surfaces. Erasing rectangles instead of derived material
 * alpha avoids rewalking the optical graph when WebKit computes outsets. */
export function composeSparseLayers(units: readonly SparseCompositionUnit[], result = "scene", source = "SourceGraphic"): string {
  if (!units.length) return merge([source], result);
  const groups: { members: number[]; bounds: FilterBounds }[] = [];
  units.forEach((unit, index) => {
    for (const part of unit.parts ?? [unit.bounds]) {
      let group = { members: [index], bounds: snap(part) };
      // A union box can enclose another group even if its members do not
      // touch. Merge to closure so the final rectangular outputs are disjoint.
      for (let candidate = 0; candidate < groups.length;) {
        if (!intersects(group.bounds, groups[candidate]!.bounds)) { candidate++; continue; }
        const joined = groups.splice(candidate, 1)[0]!;
        group = { members: [...new Set([...group.members, ...joined.members])], bounds: snap(unionSamplingBounds([group.bounds, joined.bounds])) };
        candidate = 0;
      }
      group.members.sort((a, b) => a - b);
      groups.push(group);
    }
  });
  // A unit whose members fall in several groups draws in each through its
  // group's rectangle, so no rectangle receives its layers twice.
  const homes = new Map<number, number>();
  for (const group of groups) for (const member of group.members) homes.set(member, (homes.get(member) ?? 0) + 1);
  const shared = (member: number) => homes.get(member)! > 1 && groups.some((group) => group.members.length > 1 && group.members.includes(member));
  const parts: string[] = [], areas: string[] = [], outputs: string[] = [];
  const cut = new Set<number>(), drawn = new Set<number>();
  groups.forEach((group, index) => {
    const only = group.members.length === 1 ? group.members[0]! : undefined;
    if (only !== undefined && !shared(only)) {
      // Nothing else draws in this rectangle. The surface's own coverage
      // cuts the source, and its layers go straight into the final merge.
      const unit = units[only]!;
      if (!cut.has(only)) { cut.add(only); areas.push(unit.mask); }
      if (!drawn.has(only)) { drawn.add(only); outputs.push(...unit.layers); }
      return;
    }
    const p = `${result}-group${index}`;
    if (only !== undefined) {
      // A lone member of a unit that also draws elsewhere: its coverage
      // still cuts the source, and its layers are clipped to this member.
      const unit = units[only]!;
      if (!cut.has(only)) { cut.add(only); areas.push(unit.mask); }
      parts.push(merge(unit.layers, p, group.bounds));
      outputs.push(p);
      return;
    }
    const box = region(group.bounds);
    const area = `${p}-area`;
    parts.push(`<feFlood flood-color="white" ${box} result="${area}"/>`);
    areas.push(area);
    let input = `${p}-source`;
    parts.push(`<feComposite in="${source}" in2="${area}" operator="in" ${box} result="${input}"/>`);
    for (const member of group.members) {
      const unit = units[member]!, outside = `${p}-${unit.id}-outside`, output = `${p}-${unit.id}-output`;
      parts.push(`<feComposite in="${input}" in2="${unit.mask}" operator="out" ${box} result="${outside}"/>`);
      parts.push(merge([outside, ...unit.layers], output, group.bounds));
      input = output;
    }
    outputs.push(input);
  });
  let cutArea = areas[0]!;
  if (areas.length > 1) {
    parts.push(merge(areas, `${result}-areas`, unionSamplingBounds(groups.map((group) => group.bounds))));
    cutArea = `${result}-areas`;
  }
  parts.push(`<feComposite in="${source}" in2="${cutArea}" operator="out" result="${result}-outside"/>`);
  // The regions are disjoint from the retained source, so drawing them over it
  // is exact. Software filters draw a merge with the platform's blitter; an
  // arithmetic sum would convert and clamp every pixel of the scene.
  parts.push(merge([`${result}-outside`, ...outputs], result));
  return parts.join("");
}
