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
}

const intersects = (a: FilterBounds, b: FilterBounds) => a.x < b.x + b.width && b.x < a.x + a.width
  && a.y < b.y + b.height && b.y < a.y + a.height;
const region = (box: FilterBounds) => `x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}"`;
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
    let group = { members: [index], bounds: unit.bounds };
    // A union box can enclose another group even if its members do not
    // touch. Merge to closure so the final rectangular outputs are disjoint.
    for (let candidate = 0; candidate < groups.length;) {
      if (!intersects(group.bounds, groups[candidate]!.bounds)) { candidate++; continue; }
      const joined = groups.splice(candidate, 1)[0]!;
      group = { members: [...group.members, ...joined.members], bounds: unionSamplingBounds([group.bounds, joined.bounds]) };
      candidate = 0;
    }
    group.members.sort((a, b) => a - b);
    groups.push(group);
  });
  const parts: string[] = [], areas: string[] = [], outputs: string[] = [];
  groups.forEach((group, index) => {
    const p = `${result}-group${index}`, box = region(group.bounds);
    const area = `${p}-area`;
    parts.push(`<feFlood flood-color="white" ${box} result="${area}"/>`);
    areas.push(area);
    let input = `${p}-source`;
    parts.push(`<feComposite in="${source}" in2="${area}" operator="in" ${box} result="${input}"/>`);
    for (const member of group.members) {
      const unit = units[member]!, outside = `${result}-${unit.id}-outside`, output = `${result}-${unit.id}-output`;
      parts.push(`<feComposite in="${input}" in2="${unit.mask}" operator="out" ${box} result="${outside}"/>`);
      parts.push(merge([outside, ...unit.layers], output, group.bounds));
      input = output;
    }
    outputs.push(input);
  });
  const allBounds = unionSamplingBounds(groups.map((group) => group.bounds));
  parts.push(merge(areas, `${result}-areas`, allBounds));
  parts.push(`<feComposite in="${source}" in2="${result}-areas" operator="out" result="${result}-outside"/>`);
  parts.push(merge(outputs, `${result}-layers`, allBounds));
  // Regions are disjoint from the retained source, so addition preserves
  // partial alpha without attenuating antialiased rectangle boundaries twice.
  parts.push(`<feComposite in="${result}-outside" in2="${result}-layers" operator="arithmetic" k2="1" k3="1" result="${result}"/>`);
  return parts.join("");
}
