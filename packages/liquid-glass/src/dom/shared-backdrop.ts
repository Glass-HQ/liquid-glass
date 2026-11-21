import { glassRecipe } from "../core/materials.js";
import type { MaterialOptions } from "../core/materials.js";
import type { FilterBounds } from "./filter-bounds.js";
import { unionSamplingBounds } from "./sampling-bounds.js";
import { backdropMarkup } from "./material-graph.js";

interface BackdropConsumer<T> {
  key: T;
  /** Stable material-unit identity, independent of the other consumers. */
  id: string;
  options: MaterialOptions;
  /** The shorter side of the glass, which sets its frost. */
  size: number;
  bounds: FilterBounds;
  /** Additional glass layers sampled alongside SourceGraphic. */
  inputs: readonly unknown[];
}
interface BackdropMaterial {
  result: string;
  markup: string;
}

/** Glass reading the same unmodified backdrop, frosted alike, can reuse its
 * blur. Refraction, tone, tint and coverage remain per lens. With `backdrop`,
 * the scene's backdrop color lies beneath the source, across only what the
 * blur reads. */
export function sharedBackdropMaterials<T>(
  consumers: readonly BackdropConsumer<T>[],
  soften: number,
  backdrop = false,
): Map<T, BackdropMaterial> {
  // Glass of the same material, appearance and frost frosts its backdrop alike.
  const groups = new Map<string, BackdropConsumer<T>[]>();
  for (const consumer of consumers) {
    if (consumer.inputs.length) continue;
    const o = consumer.options;
    const key = `${o.material ?? "regular"}-${o.appearance ?? "light"}-${o.frost ?? 0}-${glassRecipe(o, consumer.size).blur}`;
    const group = groups.get(key) ?? [];
    group.push(consumer);
    groups.set(key, group);
  }
  const result = new Map<T, BackdropMaterial>();
  const region = (box: FilterBounds) =>
    `x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}"`;
  for (const [key, group] of groups) {
    const frost = glassRecipe(group[0].options, group[0].size).blur * soften;
    // WebKit's software blur copies only its output rectangle before
    // convolving it. Keep the kernel away from every consumed pixel so a
    // newly opened lens cannot change another lens's blur at that edge.
    const frostHalo = Math.ceil(3 * frost) + 2;
    const padded = (box: FilterBounds, halo: number): FilterBounds => ({
      x: box.x - halo,
      y: box.y - halo,
      width: box.width + 2 * halo,
      height: box.height + 2 * halo,
    });
    // A Gaussian makes three convolution passes. A shared rectangle must save
    // work rather than filling a large empty gap between distant lenses.
    // Singletons retain their own pass.
    const areaOf = (box: FilterBounds) => box.width * box.height;
    const cost = (box: FilterBounds) => 3 * areaOf(padded(box, frostHalo));
    const clusters: { members: BackdropConsumer<T>[]; bounds: FilterBounds }[] = [];
    for (const consumer of group) {
      let best = -1,
        saving = 0,
        joined = consumer.bounds;
      for (const [index, cluster] of clusters.entries()) {
        const bounds = unionSamplingBounds([cluster.bounds, consumer.bounds]);
        const reduction = cost(cluster.bounds) + cost(consumer.bounds) - cost(bounds);
        if (reduction > saving) {
          best = index;
          saving = reduction;
          joined = bounds;
        }
      }
      if (best < 0) clusters.push({ members: [consumer], bounds: consumer.bounds });
      else {
        clusters[best].members.push(consumer);
        clusters[best].bounds = joined;
      }
    }
    for (const { members, bounds } of clusters) {
      const p =
        members.length === 1
          ? members[0].id
          : `shared-${key.replace(/[^a-z0-9]/gi, "")}-${members
              .map((member) => member.id)
              .sort()
              .join("-")}`;
      const read = padded(bounds, frostHalo);
      const source = backdrop ? `${p}backed` : "SourceGraphic";
      const material = {
        result: `${p}mix`,
        markup: `${backdrop ? `${backdropMarkup(`${p}frostBackdrop`, read)}<feMerge result="${source}" ${region(read)}><feMergeNode in="${p}frostBackdrop"/><feMergeNode in="SourceGraphic"/></feMerge>` : ""}<feGaussianBlur in="${source}" stdDeviation="${frost}" result="${p}mix" ${region(read)}/>`,
      };
      for (const consumer of members) result.set(consumer.key, material);
    }
  }
  return result;
}
