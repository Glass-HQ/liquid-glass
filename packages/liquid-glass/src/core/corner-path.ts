/* The continuous corners of Lisse (@lisse/core, MIT License, Copyright (c)
 * 2026 Jace Attard), reduced to the uniform shapes glass draws: one radius and
 * smoothing on all four corners, as a Figma squircle or a circular arc. The
 * output is byte-identical to Lisse's generatePath for these options; the
 * library's other curves and per-corner radii never ship with the glass. */

export interface CornerOptions {
  radius: number;
  smoothing: number;
  preserveSmoothing: boolean;
  curve: "squircle" | "arc";
}

const f = (n: number) => n.toFixed(4);
const radians = (degrees: number) => degrees * Math.PI / 180;

/** Bézier parameters of one squircle corner, after Figma's "Desperately
 * seeking squircles" and MartinRGB's approximation of it. */
function cornerParams(radius: number, smoothing: number, preserveSmoothing: boolean, budget: number) {
  if (radius <= 0) return { a: 0, b: 0, c: 0, d: 0, p: 0, arc: 0 };
  let p = (1 + smoothing) * radius;
  if (!preserveSmoothing) {
    smoothing = Math.min(smoothing, budget / radius - 1);
    p = Math.min(p, budget);
  }
  const arcMeasure = 90 * (1 - smoothing);
  const arc = Math.sin(radians(arcMeasure / 2)) * radius * Math.sqrt(2);
  const p3ToP4 = radius * Math.tan(radians((90 - arcMeasure) / 4));
  const beta = 45 * smoothing;
  const c = p3ToP4 * Math.cos(radians(beta));
  const d = c * Math.tan(radians(beta));
  let b = (p - arc - c - d) / 3;
  let a = 2 * b;
  if (preserveSmoothing && p > budget) {
    const reach = budget - d - arc - c;
    b = Math.min(b, reach - reach / 6);
    a = reach - b;
    p = Math.min(p, budget);
  }
  return { a, b, c, d, p, arc };
}

type Orient = "TR" | "BR" | "BL" | "TL";

/** Each corner's relative segment, entering and leaving along its edges. */
function squircleCorner(radius: number, smoothing: number, preserveSmoothing: boolean, budget: number) {
  const { a, b, c, d, p, arc } = cornerParams(radius, smoothing, preserveSmoothing, budget);
  const [A, AB, ABC, C, BC, D] = [a, a + b, a + b + c, c, b + c, d].map((n) => [f(n), f(-n)] as const);
  const r = f(radius), s = f(arc), sn = "-" + s;
  const segments: Record<Orient, string> = {
    TR: `c ${A[0]} 0 ${AB[0]} 0 ${ABC[0]} ${D[0]} a ${r} ${r} 0 0 1 ${s} ${s} c ${D[0]} ${C[0]} ${D[0]} ${BC[0]} ${D[0]} ${ABC[0]}`,
    BR: `c 0 ${A[0]} 0 ${AB[0]} ${D[1]} ${ABC[0]} a ${r} ${r} 0 0 1 ${sn} ${s} c ${C[1]} ${D[0]} ${BC[1]} ${D[0]} ${ABC[1]} ${D[0]}`,
    BL: `c ${A[1]} 0 ${AB[1]} 0 ${ABC[1]} ${D[1]} a ${r} ${r} 0 0 1 ${sn} ${sn} c ${D[1]} ${C[1]} ${D[1]} ${BC[1]} ${D[1]} ${ABC[1]}`,
    TL: `c 0 ${A[1]} 0 ${AB[1]} ${D[0]} ${ABC[1]} a ${r} ${r} 0 0 1 ${s} ${sn} c ${C[0]} ${D[1]} ${BC[0]} ${D[1]} ${ABC[0]} ${D[1]}`,
  };
  return { p, segments };
}

function arcCorner(radius: number, budget: number) {
  const p = Math.min(radius, budget);
  const r = f(p), n = f(-p);
  const segments: Record<Orient, string> = {
    TR: `a ${r} ${r} 0 0 1 ${r} ${r}`, BR: `a ${r} ${r} 0 0 1 ${n} ${r}`,
    BL: `a ${r} ${r} 0 0 1 ${n} ${n}`, TL: `a ${r} ${r} 0 0 1 ${r} ${n}`,
  };
  return { p, segments };
}

/** A fully rounded end as one continuous cap: the squircle's shoulder on the
 * flat side only, with the circle carried to the midline. */
function capText(radius: number, smoothing: number, preserveSmoothing: boolean, longHalf: number) {
  const { a, b, c, d, p } = cornerParams(radius, Math.min(smoothing, longHalf / radius - 1), preserveSmoothing, longHalf);
  const e = a + b + c;
  const [A, AB, E, C, BC, D, AX, AY] = [a, a + b, e, c, b + c, d, p - e, radius - d].map((n) => [f(n), f(-n)] as const);
  return { p, r: f(radius), A, AB, E, C, BC, D, AX, AY };
}

/** Uniform squircles whose short side lies between 2R and 2(1+s)R give up
 * smoothing on the short edges only, so they resize smoothly into a capsule. */
function blendPath(width: number, height: number, radius: number, smoothing: number, preserveSmoothing: boolean): string {
  const shoulder = (room: number) => {
    const edge = Math.max(0, Math.min(room / radius - 1, smoothing));
    const { a, b, p } = cornerParams(radius, edge, preserveSmoothing, room);
    const beta = radians(45 * edge);
    return { a, b, p, sin: Math.sin(beta), cos: Math.cos(beta) };
  };
  const H = shoulder(width / 2), V = shoulder(height / 2);
  const r4 = (n: number) => f(Object.is(n, -0) ? 0 : n);
  const corner = (cx: number, cy: number, ux: number, uy: number, vx: number, vy: number) => {
    const s1 = uy === 0 ? H : V, s2 = vy === 0 ? H : V;
    const ox = cx + (ux + vx) * radius, oy = cy + (uy + vy) * radius;
    const j1x = ox - vx * radius * s1.cos - ux * radius * s1.sin, j1y = oy - vy * radius * s1.cos - uy * radius * s1.sin;
    const j2x = ox - ux * radius * s2.cos - vx * radius * s2.sin, j2y = oy - uy * radius * s2.cos - vy * radius * s2.sin;
    const p0x = cx + ux * s1.p, p0y = cy + uy * s1.p;
    const arced = Math.hypot(j2x - j1x, j2y - j1y) > 1e-6;
    const ex = arced ? j2x : j1x, ey = arced ? j2y : j1y;
    const p3x = cx + vx * s2.p, p3y = cy + vy * s2.p;
    let d = `L ${r4(p0x)} ${r4(p0y)} `;
    d += `c ${r4(-ux * s1.a)} ${r4(-uy * s1.a)} ${r4(-ux * (s1.a + s1.b))} ${r4(-uy * (s1.a + s1.b))} ${r4(j1x - p0x)} ${r4(j1y - p0y)} `;
    if (arced) d += `a ${r4(radius)} ${r4(radius)} 0 0 1 ${r4(j2x - j1x)} ${r4(j2y - j1y)} `;
    return d + `c ${r4(p3x - vx * (s2.a + s2.b) - ex)} ${r4(p3y - vy * (s2.a + s2.b) - ey)} ${r4(p3x - vx * s2.a - ex)} ${r4(p3y - vy * s2.a - ey)} ${r4(p3x - ex)} ${r4(p3y - ey)}`;
  };
  return `M ${r4(H.p)} 0 ${corner(width, 0, -1, 0, 0, 1)} ${corner(width, height, 0, -1, -1, 0)} ${corner(0, height, 1, 0, 0, -1)} ${corner(0, 0, 0, 1, 1, 0)} Z`;
}

/** SVG path `d` for a rectangle with continuous corners. */
export function cornerPath(width: number, height: number, { radius, smoothing, preserveSmoothing, curve }: CornerOptions): string {
  if (width <= 0 || height <= 0) return "M 0 0 H 0 V 0 H 0 Z";
  if (radius <= 0) return `M 0 0 H ${width} V ${height} H 0 Z`;
  const budget = Math.min(width, height) / 2;
  const R = Math.min(radius, budget);
  if (curve === "squircle") {
    if (budget > R + 1e-9 && budget < (1 + smoothing) * R - 1e-9) return blendPath(width, height, R, smoothing, preserveSmoothing);
    if (Math.abs(R - budget) < 1e-9) {
      const t = capText(budget, smoothing, preserveSmoothing, Math.max(width, height) / 2);
      if (width >= height) {
        const right = `c ${t.A[0]} 0 ${t.AB[0]} 0 ${t.E[0]} ${t.D[0]} a ${t.r} ${t.r} 0 0 1 ${t.AX[0]} ${t.AY[0]} a ${t.r} ${t.r} 0 0 1 ${t.AX[1]} ${t.AY[0]} c ${t.C[1]} ${t.D[0]} ${t.BC[1]} ${t.D[0]} ${t.E[1]} ${t.D[0]}`;
        const left = `c ${t.A[1]} 0 ${t.AB[1]} 0 ${t.E[1]} ${t.D[1]} a ${t.r} ${t.r} 0 0 1 ${t.AX[1]} ${t.AY[1]} a ${t.r} ${t.r} 0 0 1 ${t.AX[0]} ${t.AY[1]} c ${t.C[0]} ${t.D[1]} ${t.BC[0]} ${t.D[1]} ${t.E[0]} ${t.D[1]}`;
        return `M ${f(t.p)} 0 L ${f(width - t.p)} 0 ${right} L ${f(t.p)} ${f(height)} ${left} Z`;
      }
      const top = `c 0 ${t.A[1]} 0 ${t.AB[1]} ${t.D[0]} ${t.E[1]} a ${t.r} ${t.r} 0 0 1 ${t.AY[0]} ${t.AX[1]} a ${t.r} ${t.r} 0 0 1 ${t.AY[0]} ${t.AX[0]} c ${t.D[0]} ${t.C[0]} ${t.D[0]} ${t.BC[0]} ${t.D[0]} ${t.E[0]}`;
      const bottom = `c 0 ${t.A[0]} 0 ${t.AB[0]} ${t.D[1]} ${t.E[0]} a ${t.r} ${t.r} 0 0 1 ${t.AY[1]} ${t.AX[0]} a ${t.r} ${t.r} 0 0 1 ${t.AY[1]} ${t.AX[1]} c ${t.D[1]} ${t.C[1]} ${t.D[1]} ${t.BC[1]} ${t.D[1]} ${t.E[1]}`;
      return `M 0 ${f(t.p)} ${top} L ${f(width)} ${f(height - t.p)} ${bottom} L 0 ${f(t.p)} Z`;
    }
  }
  const { p, segments: s } = curve === "squircle" ? squircleCorner(R, smoothing, preserveSmoothing, budget) : arcCorner(R, budget);
  const seg = (orient: Orient) => s[orient] ? " " + s[orient] : "";
  return `M ${f(p)} 0 L ${f(width - p)} 0${seg("TR")} L ${f(width)} ${f(p)} L ${f(width)} ${f(height - p)}${seg("BR")}`
    + ` L ${f(width - p)} ${f(height)} L ${f(p)} ${f(height)}${seg("BL")} L 0 ${f(height - p)} L 0 ${f(p)}${seg("TL")} Z`;
}
