/** Bounds of the source and every optical surface, including transformed controls. */
export interface FilterBounds { x: number; y: number; width: number; height: number }
export function filterBounds(width: number, height: number, surfaces: readonly FilterBounds[], padding: number): FilterBounds {
  const left = Math.min(0, ...surfaces.map((s) => s.x)) - padding;
  const top = Math.min(0, ...surfaces.map((s) => s.y)) - padding;
  const right = Math.max(width, ...surfaces.map((s) => s.x + s.width)) + padding;
  const bottom = Math.max(height, ...surfaces.map((s) => s.y + s.height)) + padding;
  return { x: left, y: top, width: right - left, height: bottom - top };
}
export interface EdgeSides {
  left: boolean; top: boolean; right: boolean; bottom: boolean;
  /** Corners some region reaches past on both of its sides, indexed [x][y] as 0 or 2. */
  corners: Set<string>;
}
/** Which content edges, and which corners, a sampled region crosses. */
export function crossedSides(width: number, height: number, regions: readonly FilterBounds[]): EdgeSides {
  const corners = new Set<string>();
  for (const r of regions) {
    const left = r.x < 0, top = r.y < 0, right = r.x + r.width > width, bottom = r.y + r.height > height;
    if (left && top) corners.add("00");
    if (right && top) corners.add("20");
    if (left && bottom) corners.add("02");
    if (right && bottom) corners.add("22");
  }
  return {
    left: regions.some((r) => r.x < 0),
    top: regions.some((r) => r.y < 0),
    right: regions.some((r) => r.x + r.width > width),
    bottom: regions.some((r) => r.y + r.height > height),
    corners,
  };
}
/** Edge tiles that extend the live source past its sides by repeating its
 * edge pixels, like a clamp-to-edge sampler. Only the sides and corners some
 * surface samples past are produced; a scene whose glass stays inside its
 * content needs none. Each tile is a named result a surface merges into its
 * own cropped backdrop, so no full-size extended copy of the source is ever
 * built or re-evaluated. */
export function edgeTiles(width: number, height: number, bounds: FilterBounds, prefix: string, sides: EdgeSides): { markup: string; names: Record<string, string> } {
  const pixel = Math.min(1, width, height);
  const xs = [
    { source: 0, size: pixel, target: bounds.x, extent: -bounds.x, needed: sides.left },
    { source: 0, size: width, target: 0, extent: width, needed: true },
    { source: width - pixel, size: pixel, target: width, extent: bounds.x + bounds.width - width, needed: sides.right },
  ];
  const ys = [
    { source: 0, size: pixel, target: bounds.y, extent: -bounds.y, needed: sides.top },
    { source: 0, size: height, target: 0, extent: height, needed: true },
    { source: height - pixel, size: pixel, target: height, extent: bounds.y + bounds.height - height, needed: sides.bottom },
  ];
  const parts: string[] = [];
  const names: Record<string, string> = {};
  xs.forEach((x, i) => ys.forEach((y, j) => {
    if ((i === 1 && j === 1) || !x.needed || !y.needed || x.extent <= 0 || y.extent <= 0) return;
    if (i !== 1 && j !== 1 && !sides.corners.has(`${i}${j}`)) return;
    const id = `${prefix}edge${i}${j}`;
    parts.push(`<feOffset in="SourceGraphic" dx="0" dy="0" x="${x.source}" y="${y.source}" width="${x.size}" height="${y.size}" result="${id}"/><feTile in="${id}" x="${x.target}" y="${y.target}" width="${x.extent}" height="${y.extent}" result="${id}tile"/>`);
    names[`${i}${j}`] = `${id}tile`;
  }));
  return { markup: parts.join(""), names };
}
/** The tile keys a region needs: its crossed sides, and the corners of two crossed sides. */
export function tilesFor(width: number, height: number, r: FilterBounds): string[] {
  const left = r.x < 0, top = r.y < 0, right = r.x + r.width > width, bottom = r.y + r.height > height;
  const keys: string[] = [];
  if (left) keys.push("01");
  if (right) keys.push("21");
  if (top) keys.push("10");
  if (bottom) keys.push("12");
  if (left && top) keys.push("00");
  if (right && top) keys.push("20");
  if (left && bottom) keys.push("02");
  if (right && bottom) keys.push("22");
  return keys;
}
