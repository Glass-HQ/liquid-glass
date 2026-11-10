import type { FilterBounds } from "./filter-bounds.js";

interface LensBox { x: number; y: number; w: number; h: number }
/** Displacement images are opaque through their two-pixel border. Their
 * padded boxes must not overlap, even when the visible glass does not. */
export function mapBoxesOverlap(a: LensBox, b: LensBox): boolean {
  return a.x - 2 < b.x + b.w + 2 && b.x - 2 < a.x + a.w + 2 &&
    a.y - 2 < b.y + b.h + 2 && b.y - 2 < a.y + a.h + 2;
}

export interface BranchRegions {
  output: FilterBounds;
  crop: FilterBounds;
  sampled: FilterBounds;
}
interface Cluster<T> extends BranchRegions { members: T[]; images: number }
const area = (box: FilterBounds) => box.width * box.height;
function union(a: FilterBounds, b: FilterBounds): FilterBounds {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}
/** Group compatible, independent surfaces only when sharing their material
 * reduces the pixels processed by its primitives. Map images keep their
 * original area; merging four planes adds four passes over the union box.
 * This keeps distant small lenses from creating a scene-sized software pass.
 * Callers separately check the extra branches against WebKit's outset budget. */
export function clusterFilterBranches<T>(members: readonly T[], regions: (member: T) => BranchRegions,
  stages: { output: number; sampled: number }, limit = Infinity): T[][] {
  const clusters: Cluster<T>[] = [];
  const cost = (cluster: Cluster<T>) => area(cluster.crop) + stages.sampled * area(cluster.sampled)
    + (stages.output + (cluster.members.length > 1 ? 4 : 0)) * area(cluster.output) + cluster.images;
  for (const member of members) {
    const boxes = regions(member);
    const own: Cluster<T> = { ...boxes, members: [member], images: 4 * area(boxes.output) };
    let best = -1, saving = 0, joined: Cluster<T> | undefined;
    for (const [index, cluster] of clusters.entries()) {
      const candidate: Cluster<T> = {
        output: union(cluster.output, own.output), crop: union(cluster.crop, own.crop), sampled: union(cluster.sampled, own.sampled),
        members: [...cluster.members, member], images: cluster.images + own.images,
      };
      const reduction = cost(cluster) + cost(own) - cost(candidate);
      if (reduction > saving) { best = index; saving = reduction; joined = candidate; }
    }
    if (joined) clusters[best] = joined;
    else clusters.push(own);
  }
  const join = (a: Cluster<T>, b: Cluster<T>): Cluster<T> => ({
    output: union(a.output, b.output), crop: union(a.crop, b.crop), sampled: union(a.sampled, b.sampled),
    members: [...a.members, ...b.members], images: a.images + b.images,
  });
  // Over the limit, rejoin whichever two branches cost the least together.
  while (clusters.length > Math.max(1, limit)) {
    let best: [number, number, Cluster<T>] | undefined, least = Infinity;
    for (let i = 0; i < clusters.length; i++) for (let j = i + 1; j < clusters.length; j++) {
      const candidate = join(clusters[i]!, clusters[j]!);
      const added = cost(candidate) - cost(clusters[i]!) - cost(clusters[j]!);
      if (added < least) { least = added; best = [i, j, candidate]; }
    }
    const [i, j, candidate] = best!;
    clusters[i] = candidate;
    clusters.splice(j, 1);
  }
  return clusters.map((cluster) => cluster.members);
}
