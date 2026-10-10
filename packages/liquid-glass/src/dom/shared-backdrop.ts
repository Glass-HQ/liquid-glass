import { materials } from "../core/materials.js";
import type { GlassAppearance, MaterialOptions } from "../core/materials.js";
import type { FilterBounds } from "./filter-bounds.js";
import { unionSamplingBounds } from "./sampling-bounds.js";

interface BackdropConsumer<T> {
  key: T;
  /** Stable material-unit identity, independent of the other consumers. */
  id: string;
  options: MaterialOptions;
  bounds: FilterBounds;
  /** Additional glass layers sampled alongside SourceGraphic. */
  inputs: readonly unknown[];
}
interface BackdropMaterial { result: string; markup: string }

/** Regular glass reading the same unmodified backdrop can reuse its two
 * blurs and their mix. Refraction, tone, tint and coverage remain per lens. */
export function sharedBackdropMaterials<T>(consumers: readonly BackdropConsumer<T>[], soften: number): Map<T, BackdropMaterial> {
  const groups = new Map<GlassAppearance, BackdropConsumer<T>[]>();
  for (const consumer of consumers) {
    if (consumer.options.material !== "regular" || consumer.inputs.length) continue;
    const appearance = consumer.options.appearance ?? "light";
    const group = groups.get(appearance) ?? [];
    group.push(consumer);
    groups.set(appearance, group);
  }
  const result = new Map<T, BackdropMaterial>();
  const region = (box: FilterBounds) => `x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}"`;
  for (const [appearance, group] of groups) {
    const spec = materials.regular[appearance];
    const frost = materials.regular.blur * soften, fill = spec.fillSigma * soften;
    // WebKit's software blur copies only its output rectangle before
    // convolving it. Keep the kernel away from every consumed pixel so a
    // newly opened lens cannot change another lens's blur at that edge.
    const frostHalo = Math.ceil(3 * frost) + 2, fillHalo = Math.ceil(3 * fill) + 2;
    const padded = (box: FilterBounds, halo: number): FilterBounds => ({ x: box.x - halo, y: box.y - halo, width: box.width + 2 * halo, height: box.height + 2 * halo });
    // Each Gaussian makes three convolution passes, followed by the blend
    // and mix. A shared rectangle must save work rather than filling a large
    // empty gap between distant lenses. Singletons retain their own pass.
    const areaOf = (box: FilterBounds) => box.width * box.height;
    const cost = (box: FilterBounds) => 3 * areaOf(padded(box, frostHalo)) + 3 * areaOf(padded(box, fillHalo)) + 2 * areaOf(box);
    const clusters: { members: BackdropConsumer<T>[]; bounds: FilterBounds }[] = [];
    for (const consumer of group) {
      let best = -1, saving = 0, joined = consumer.bounds;
      for (const [index, cluster] of clusters.entries()) {
        const bounds = unionSamplingBounds([cluster.bounds, consumer.bounds]);
        const reduction = cost(cluster.bounds) + cost(consumer.bounds) - cost(bounds);
        if (reduction > saving) { best = index; saving = reduction; joined = bounds; }
      }
      if (best < 0) clusters.push({ members: [consumer], bounds: consumer.bounds });
      else { clusters[best]!.members.push(consumer); clusters[best]!.bounds = joined; }
    }
    for (const { members, bounds } of clusters) {
      const frostRegion = region(padded(bounds, frostHalo)), fillRegion = region(padded(bounds, fillHalo));
      const area = region(bounds);
      const p = members.length === 1 ? members[0]!.id : `shared${appearance === "dark" ? "Dark" : "Light"}-${members.map((member) => member.id).sort().join("-")}`;
      const material = {
        result: `${p}mix`,
        markup: `<feGaussianBlur in="SourceGraphic" stdDeviation="${frost}" result="${p}frost" ${frostRegion}/><feGaussianBlur in="SourceGraphic" stdDeviation="${fill}" result="${p}fill" ${fillRegion}/><feBlend in="${p}frost" in2="${p}fill" mode="${appearance === "dark" ? "darken" : "lighten"}" result="${p}blend" ${area}/><feComposite in="${p}blend" in2="${p}frost" operator="arithmetic" k2="${spec.fillOpacity}" k3="${1 - spec.fillOpacity}" k4="0" result="${p}mix" ${area}/>`,
      };
      for (const consumer of members) result.set(consumer.key, material);
    }
  }
  return result;
}
