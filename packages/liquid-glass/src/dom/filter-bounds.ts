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
  /** Along each crossed side, the range the regions crossing it cover. */
  spans?: Partial<Record<"left" | "top" | "right" | "bottom", [number, number]>>;
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
  const span = (crossing: readonly FilterBounds[], along: "x" | "y"): [number, number] | undefined => {
    if (!crossing.length) return undefined;
    const size = along === "x" ? width : height;
    const start = Math.max(0, Math.floor(Math.min(...crossing.map((r) => along === "x" ? r.x : r.y))));
    const end = Math.min(size, Math.ceil(Math.max(...crossing.map((r) => along === "x" ? r.x + r.width : r.y + r.height))));
    return end > start ? [start, end] : undefined;
  };
  const crossing = {
    left: regions.filter((r) => r.x < 0), top: regions.filter((r) => r.y < 0),
    right: regions.filter((r) => r.x + r.width > width), bottom: regions.filter((r) => r.y + r.height > height),
  };
  return {
    left: crossing.left.length > 0,
    top: crossing.top.length > 0,
    right: crossing.right.length > 0,
    bottom: crossing.bottom.length > 0,
    corners,
    spans: { left: span(crossing.left, "y"), top: span(crossing.top, "x"), right: span(crossing.right, "y"), bottom: span(crossing.bottom, "x") },
  };
}
/** Edge tiles that extend the live source past its sides by repeating its
 * edge pixels, like a clamp-to-edge sampler. Only the sides and corners some
 * surface samples past are produced; a scene whose glass stays inside its
 * content needs none. Each tile is a named result a surface merges into its
 * own cropped backdrop, so no full-size extended copy of the source is ever
 * built or re-evaluated. */
export function edgeTiles(width: number, height: number, bounds: FilterBounds, prefix: string, sides: EdgeSides, source = "SourceGraphic"): { markup: string; names: Record<string, string> } {
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
  xs.forEach((xFull, i) => ys.forEach((yFull, j) => {
    // A side's strip repeats only the range the regions crossing it read.
    const along = i === 1 ? sides.spans?.[j === 0 ? "top" : "bottom"] : j === 1 ? sides.spans?.[i === 0 ? "left" : "right"] : undefined;
    const x = i === 1 && along ? { ...xFull, source: along[0], size: along[1] - along[0], target: along[0], extent: along[1] - along[0] } : xFull;
    const y = j === 1 && along ? { ...yFull, source: along[0], size: along[1] - along[0], target: along[0], extent: along[1] - along[0] } : yFull;
    if ((i === 1 && j === 1) || !x.needed || !y.needed || x.extent <= 0 || y.extent <= 0) return;
    if (i !== 1 && j !== 1 && !sides.corners.has(`${i}${j}`)) return;
    const id = `${prefix}edge${i}${j}`;
    parts.push(`<feOffset in="${source}" dx="0" dy="0" x="${x.source}" y="${y.source}" width="${x.size}" height="${y.size}" result="${id}"/>`);
    const corner = i !== 1 && j !== 1;
    // Gecko copies each repeated tile in software. Fill a corner one axis
    // at a time so it copies rows instead of one tiny tile per output pixel.
    // Keep the source row's y/height, and the output's x/width, so both
    // repetitions retain exactly the original period and phase.
    if (corner) parts.push(`<feTile in="${id}" x="${x.target}" y="${y.source}" width="${x.extent}" height="${y.size}" result="${id}row"/>`);
    parts.push(`<feTile in="${corner ? `${id}row` : id}" x="${x.target}" y="${y.target}" width="${x.extent}" height="${y.extent}" result="${id}tile"/>`);
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

/** Whether two boxes share any area. */
export const boundsMeet = (a: FilterBounds, b: FilterBounds) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
