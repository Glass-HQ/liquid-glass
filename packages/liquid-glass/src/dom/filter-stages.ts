/** Count this library's generated SVG primitives, excluding their child
 * transfer functions and merge inputs. Gecko's operation cap counts the
 * descriptions before expanding merge inputs into GPU operations. */
export function filterPrimitiveCount(markup: string): number {
  return [...markup.matchAll(/<fe(?!Func[RGBA]\b|MergeNode\b)[A-Z][\w]*\b/g)].length;
}

export interface FilterStage<T> { groups: T[]; markup: string; primitives: number }
/** Each stage must be assigned to a distinct nested DOM element. Multiple
 * url() references on one element still share Gecko's 64-operation cap. */
export function partitionFilterStages<T>(groups: readonly T[], render: (groups: readonly T[]) => string, limit = 64): FilterStage<T>[] {
  const stages: FilterStage<T>[] = [];
  let stage: FilterStage<T> | undefined;
  for (const group of groups) {
    const candidate = [...(stage?.groups ?? []), group];
    const markup = render(candidate), primitives = filterPrimitiveCount(markup);
    if (primitives <= limit) { stage = { groups: candidate, markup, primitives }; continue; }
    if (stage) stages.push(stage);
    const own = render([group]), count = filterPrimitiveCount(own);
    if (count > limit) throw new RangeError(`One glass branch requires ${count} filter operations; this browser supports ${limit} per element.`);
    stage = { groups: [group], markup: own, primitives: count };
  }
  if (stage) stages.push(stage);
  return stages;
}
/** Gecko's filter description limit applies to the complete chain on one element. */
export const gecko = typeof navigator !== "undefined" && /Gecko\//.test(navigator.userAgent) && !/like Gecko/.test(navigator.userAgent);
