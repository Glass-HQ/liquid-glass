/**
 * Rect and radius arithmetic shared by the scene and the motion machines. Rects are top-left
 * based (`protocol.Rect`); motion often works around centres, so `Box` is the same rect
 * described by its centre.
 */

import type { Radii, Rect } from "../protocol";

/** A rect described by its centre. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export const mix = (from: number, to: number, amount: number): number =>
  from + (to - from) * amount;

export const rect = (x: number, y: number, width: number, height: number): Rect => ({
  x,
  y,
  width,
  height,
});

export const zeroRect: Rect = { x: 0, y: 0, width: 0, height: 0 };

export const toBox = (r: Rect): Box => ({
  x: r.x + r.width / 2,
  y: r.y + r.height / 2,
  width: r.width,
  height: r.height,
});

export const fromBox = (b: Box): Rect => ({
  x: b.x - b.width / 2,
  y: b.y - b.height / 2,
  width: b.width,
  height: b.height,
});

/** Grow (or with negative values shrink) a rect on each side. */
export const outset = (r: Rect, dx: number, dy = dx): Rect => ({
  x: r.x - dx,
  y: r.y - dy,
  width: Math.max(0, r.width + dx * 2),
  height: Math.max(0, r.height + dy * 2),
});

export const translate = (r: Rect, dx: number, dy: number): Rect => ({
  x: r.x + dx,
  y: r.y + dy,
  width: r.width,
  height: r.height,
});

/** Scale a rect about a point (its own centre by default). */
export function scaleRect(
  r: Rect,
  sx: number,
  sy = sx,
  about = { x: r.x + r.width / 2, y: r.y + r.height / 2 },
): Rect {
  return {
    x: about.x + (r.x - about.x) * sx,
    y: about.y + (r.y - about.y) * sy,
    width: r.width * sx,
    height: r.height * sy,
  };
}

export const mixRect = (a: Rect, b: Rect, amount: number): Rect => ({
  x: mix(a.x, b.x, amount),
  y: mix(a.y, b.y, amount),
  width: mix(a.width, b.width, amount),
  height: mix(a.height, b.height, amount),
});

export const containsPoint = (r: Rect, x: number, y: number): boolean =>
  x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;

export function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

export function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

export const sameRect = (a: Rect, b: Rect, epsilon = 0): boolean =>
  Math.abs(a.x - b.x) <= epsilon &&
  Math.abs(a.y - b.y) <= epsilon &&
  Math.abs(a.width - b.width) <= epsilon &&
  Math.abs(a.height - b.height) <= epsilon;

/** A rect of DOMRect-like values, copied so it can be posted. */
export const fromDomRect = (r: { x: number; y: number; width: number; height: number }): Rect => ({
  x: r.x,
  y: r.y,
  width: r.width,
  height: r.height,
});

// ---------------------------------------------------------------------------------------------
// Radii
// ---------------------------------------------------------------------------------------------

export const uniformRadii = (radius: number): Radii => [radius, radius, radius, radius];

/** Fully rounded ends along the shorter side. */
export const capsuleRadii = (r: { readonly width: number; readonly height: number }): Radii =>
  uniformRadii(Math.max(0, Math.min(r.width, r.height) / 2));

/**
 * Shrink radii that don't fit, the way CSS does: when two corners on one side ask for more
 * than the side's length, every corner is scaled by the same factor.
 */
export function fitRadii(
  radii: Radii,
  size: { readonly width: number; readonly height: number },
): Radii {
  const tl = Math.max(0, radii[0]);
  const tr = Math.max(0, radii[1]);
  const br = Math.max(0, radii[2]);
  const bl = Math.max(0, radii[3]);
  const sums = [tl + tr, tr + br, br + bl, bl + tl];
  const sides = [size.width, size.height, size.width, size.height];
  let factor = 1;
  for (let i = 0; i < 4; i += 1) {
    const sum = sums[i] ?? 0;
    const side = sides[i] ?? 0;
    if (sum > side) factor = Math.min(factor, sum > 0 ? side / sum : 0);
  }
  return factor < 1 ? [tl * factor, tr * factor, br * factor, bl * factor] : [tl, tr, br, bl];
}

export const scaleRadii = (radii: Radii, factor: number): Radii => [
  radii[0] * factor,
  radii[1] * factor,
  radii[2] * factor,
  radii[3] * factor,
];

/** How a shape's corners are given: fully round ends, one radius, or each corner. */
export type RadiusSpec = "capsule" | number | Radii;

export function resolveRadii(
  spec: RadiusSpec,
  size: { readonly width: number; readonly height: number },
): Radii {
  if (spec === "capsule") return capsuleRadii(size);
  if (typeof spec === "number") return fitRadii(uniformRadii(spec), size);
  return fitRadii(spec, size);
}

/**
 * Corners for a shape nested in a container, concentric with the container's corners. Each
 * corner of `inner` (a rect in the container's px) takes the container's radius at that corner
 * less how far it sits from it (the larger of its distances to the corner's two edges), so the
 * two curves run parallel. Away from the container's corners that is less than `own`, which it
 * keeps: a row in the middle of a menu has its own radius, the first row's top corners follow
 * the menu's. A side never holds more curve than its length: the corner beside a following one gives way.
 */
export function concentricRadii(
  inner: Rect,
  container: { readonly width: number; readonly height: number },
  containerRadii: Radii,
  own: Radii,
): Radii {
  const left = inner.x;
  const top = inner.y;
  const right = container.width - inner.x - inner.width;
  const bottom = container.height - inner.y - inner.height;
  const corner = (outer: number, a: number, b: number) => Math.max(0, outer - Math.max(a, b, 0));
  const follow = [
    corner(containerRadii[0], top, left),
    corner(containerRadii[1], top, right),
    corner(containerRadii[2], bottom, right),
    corner(containerRadii[3], bottom, left),
  ];
  const radii = follow.map((r, i) => Math.max(r, own[i] ?? 0));
  // A side can't hold more curve than its length. A corner following the container keeps its
  // curve and the corner beside it gives way; two following corners share the side.
  const fit = (a: number, b: number, length: number) => {
    const ra = radii[a] ?? 0;
    const rb = radii[b] ?? 0;
    if (ra + rb <= length) return;
    const fa = (follow[a] ?? 0) >= ra && ra > (own[a] ?? 0);
    const fb = (follow[b] ?? 0) >= rb && rb > (own[b] ?? 0);
    if (fa && !fb) radii[b] = Math.max(0, length - Math.min(ra, length));
    else if (fb && !fa) radii[a] = Math.max(0, length - Math.min(rb, length));
    else {
      const k = length / (ra + rb);
      radii[a] = ra * k;
      radii[b] = rb * k;
    }
    radii[a] = Math.min(radii[a] ?? 0, length);
    radii[b] = Math.min(radii[b] ?? 0, length);
  };
  fit(0, 3, inner.height);
  fit(1, 2, inner.height);
  fit(0, 1, inner.width);
  fit(3, 2, inner.width);
  return [radii[0] ?? 0, radii[1] ?? 0, radii[2] ?? 0, radii[3] ?? 0];
}
