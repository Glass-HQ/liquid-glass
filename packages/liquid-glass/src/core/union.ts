import type { ShapePoint } from "./concentric.js";

/** An axis-aligned rounded rectangle in any shared coordinate space. */
export interface RoundRect {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
}

/** Signed distance to a rounded rectangle: negative inside. */
export function roundRectDistance(px: number, py: number, r: RoundRect): number {
  const radius = Math.max(0, Math.min(r.radius, r.width / 2, r.height / 2));
  const qx = Math.abs(px - (r.x + r.width / 2)) - (r.width / 2 - radius);
  const qy = Math.abs(py - (r.y + r.height / 2)) - (r.height / 2 - radius);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

/** Polynomial smooth minimum: shapes closer than `k` flow into each other. */
export function smoothMin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/** Twice the signed area; positive for the clockwise-on-screen winding the
 * renderer expects (top edge left to right, with y pointing down). */
export function windingArea(points: readonly ShapePoint[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!, b = points[(i + 1) % points.length]!;
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum;
}

function simplify(points: ShapePoint[], epsilon: number): ShapePoint[] {
  if (points.length < 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop()!;
    const [ax, ay] = points[start]!, [bx, by] = points[end]!;
    const length = Math.hypot(bx - ax, by - ay) || 1;
    let worst = -1, index = -1;
    for (let i = start + 1; i < end; i++) {
      const [px, py] = points[i]!;
      const distance = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / length;
      if (distance > worst) { worst = distance; index = i; }
    }
    if (worst > epsilon) { keep[index] = 1; stack.push([start, index], [index, end]); }
  }
  return points.filter((_, i) => keep[i]);
}

/** Simplify a closed loop: split at the point farthest from its start so
 * neither half has coincident endpoints. */
function simplifyLoop(loop: ShapePoint[], epsilon: number): ShapePoint[] {
  const [sx, sy] = loop[0]!;
  let far = 0, best = -1;
  loop.forEach(([x, y], i) => { const d = Math.hypot(x - sx, y - sy); if (d > best) { best = d; far = i; } });
  const first = simplify(loop.slice(0, far + 1), epsilon);
  const second = simplify([...loop.slice(far), loop[0]!], epsilon);
  return [...first, ...second.slice(1, -1)];
}
/** Outlines of the smooth union of rounded rectangles, traced with marching
 * squares at `step` pixels. Returns one loop per connected body, wound the way
 * the renderer expects and simplified to at most `limit` edges each. */
export function smoothUnion(shapes: readonly RoundRect[], k: number, step = 1, limit = 1000): ShapePoint[][] {
  if (!shapes.length) return [];
  const margin = k / 2 + 2 * step;
  const left = Math.min(...shapes.map((s) => s.x)) - margin, top = Math.min(...shapes.map((s) => s.y)) - margin;
  const right = Math.max(...shapes.map((s) => s.x + s.width)) + margin, bottom = Math.max(...shapes.map((s) => s.y + s.height)) + margin;
  const columns = Math.ceil((right - left) / step) + 1, rows = Math.ceil((bottom - top) / step) + 1;
  const field = new Float64Array(columns * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < columns; i++) {
    const x = left + i * step, y = top + j * step;
    let d = Infinity;
    for (const shape of shapes) d = d === Infinity ? roundRectDistance(x, y, shape) : smoothMin(d, roundRectDistance(x, y, shape), k);
    field[j * columns + i] = d;
  }
  // Edges between grid nodes are keyed so traced segments can be linked.
  const point = new Map<number, ShapePoint>();
  const crossing = (i0: number, j0: number, i1: number, j1: number): number => {
    const key = i0 === i1 ? (j0 * columns + i0) * 2 + 1 : (j0 * columns + Math.min(i0, i1)) * 2;
    if (!point.has(key)) {
      const a = field[j0 * columns + i0]!, b = field[j1 * columns + i1]!;
      const t = a / (a - b);
      point.set(key, [left + (i0 + (i1 - i0) * t) * step, top + (j0 + (j1 - j0) * t) * step]);
    }
    return key;
  };
  const next = new Map<number, number>();
  for (let j = 0; j < rows - 1; j++) for (let i = 0; i < columns - 1; i++) {
    const tl = field[j * columns + i]! < 0, tr = field[j * columns + i + 1]! < 0;
    const br = field[(j + 1) * columns + i + 1]! < 0, bl = field[(j + 1) * columns + i]! < 0;
    const top = () => crossing(i, j, i + 1, j), rightEdge = () => crossing(i + 1, j, i + 1, j + 1);
    const bottomEdge = () => crossing(i, j + 1, i + 1, j + 1), leftEdge = () => crossing(i, j, i, j + 1);
    // Each segment runs with the inside on its right in screen space, which
    // yields the renderer's winding directly.
    const link = (a: number, b: number) => next.set(a, b);
    switch ((tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0)) {
      case 1: link(leftEdge(), bottomEdge()); break;
      case 2: link(bottomEdge(), rightEdge()); break;
      case 3: link(leftEdge(), rightEdge()); break;
      case 4: link(rightEdge(), top()); break;
      case 5: link(leftEdge(), top()); link(rightEdge(), bottomEdge()); break;
      case 6: link(bottomEdge(), top()); break;
      case 7: link(leftEdge(), top()); break;
      case 8: link(top(), leftEdge()); break;
      case 9: link(top(), bottomEdge()); break;
      case 10: link(top(), rightEdge()); link(bottomEdge(), leftEdge()); break;
      case 11: link(top(), rightEdge()); break;
      case 12: link(rightEdge(), leftEdge()); break;
      case 13: link(rightEdge(), bottomEdge()); break;
      case 14: link(bottomEdge(), leftEdge()); break;
    }
  }
  const loops: ShapePoint[][] = [];
  const visited = new Set<number>();
  for (const start of next.keys()) {
    if (visited.has(start)) continue;
    const loop: ShapePoint[] = [];
    for (let key: number | undefined = start; key !== undefined && !visited.has(key); key = next.get(key)) {
      visited.add(key);
      loop.push(point.get(key)!);
    }
    if (loop.length < 3) continue;
    let simplified = simplifyLoop(loop, step * 0.12);
    for (let epsilon = step * 0.25; simplified.length > limit; epsilon *= 1.6)
      simplified = simplifyLoop(loop, epsilon);
    if (windingArea(simplified) < 0) simplified.reverse();
    loops.push(simplified);
  }
  return loops;
}
