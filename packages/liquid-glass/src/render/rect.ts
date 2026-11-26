/** Axis-aligned boxes as [left, top, right, bottom], the form region bookkeeping needs. */
export type Box = readonly [left: number, top: number, right: number, bottom: number];

export const EMPTY: Box = [0, 0, 0, 0];

export function isEmpty(b: Box): boolean {
  return b[2] <= b[0] || b[3] <= b[1];
}

export function union(a: Box, b: Box): Box {
  if (isEmpty(a)) return b;
  if (isEmpty(b)) return a;
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

export function intersect(a: Box, b: Box): Box {
  const out: Box = [
    Math.max(a[0], b[0]),
    Math.max(a[1], b[1]),
    Math.min(a[2], b[2]),
    Math.min(a[3], b[3]),
  ];
  return isEmpty(out) ? EMPTY : out;
}

export function intersects(a: Box, b: Box): boolean {
  return !isEmpty(a) && !isEmpty(b) && a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
}

/** Whether `inner` lies entirely inside `outer`. An empty `inner` always does. */
export function contains(outer: Box, inner: Box): boolean {
  if (isEmpty(inner)) return true;
  if (isEmpty(outer)) return false;
  return (
    inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3]
  );
}

export function expand(b: Box, by: number): Box {
  if (isEmpty(b)) return b;
  return [b[0] - by, b[1] - by, b[2] + by, b[3] + by];
}

export function fromRect(x: number, y: number, width: number, height: number): Box {
  return [x, y, x + width, y + height];
}

/** The device-pixel box covering a CSS box at `scale`, rounded outwards. */
export function toPixels(b: Box, scale: number, width: number, height: number): Box {
  if (isEmpty(b)) return EMPTY;
  return intersect(
    [
      Math.floor(b[0] * scale),
      Math.floor(b[1] * scale),
      Math.ceil(b[2] * scale),
      Math.ceil(b[3] * scale),
    ],
    [0, 0, width, height],
  );
}

/**
 * Boxes that together cover what a layer needs, or holds. Far apart, they stay separate, so glass
 * at the top and at the bottom of a page doesn't make everything between them part of the region.
 */
export type Region = readonly Box[];

const area = (b: Box) => (isEmpty(b) ? 0 : (b[2] - b[0]) * (b[3] - b[1]));

/** `region` with `box` added, joined with the boxes it overlaps or nearly touches. */
export function withBox(region: Region, box: Box): Box[] {
  if (isEmpty(box)) return [...region];
  let joined = box;
  let apart = [...region];
  for (let again = true; again;) {
    again = false;
    const rest: Box[] = [];
    for (const other of apart) {
      const both = union(joined, other);
      // Joining wastes little when the bounding box is hardly larger than the two.
      if (area(both) <= 1.25 * (area(joined) + area(other))) {
        joined = both;
        again = true;
      } else rest.push(other);
    }
    apart = rest;
  }
  return [...apart, joined];
}

/** The box of `region` that holds all of `box`, or the one sharing most with it. */
export function holding(region: Region, box: Box): Box {
  let best: Box = EMPTY;
  let shared = -1;
  for (const candidate of region) {
    if (contains(candidate, box)) return candidate;
    const overlap = area(intersect(candidate, box));
    if (overlap > shared) {
      best = candidate;
      shared = overlap;
    }
  }
  return best;
}

/** Whether one box of `region` holds all of `box`. */
export function covers(region: Region, box: Box): boolean {
  return isEmpty(box) || region.some((candidate) => contains(candidate, box));
}
