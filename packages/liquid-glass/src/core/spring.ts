/**
 * Damped springs, described by a damping ratio (1 is critically
 * damped, below 1 bounces) and a response, the period in seconds of the undamped oscillation
 * (ω = 2π / response). Stepping uses the closed-form solution, so a long or uneven frame lands
 * exactly where the spring would be at that time instead of drifting or blowing up.
 *
 * A spring is plain data so state machines can hold many of them and copy them freely.
 * Retargeting keeps the current value and velocity, so any motion can be interrupted and
 * reversed mid-flight without a jump.
 */

export interface SpringParams {
  readonly dampingRatio: number;
  /** Seconds. */
  readonly response: number;
  /** Stop at the target instead of overshooting it. */
  readonly clamp?: boolean;
}

export interface Spring {
  value: number;
  velocity: number;
  target: number;
  params: SpringParams | null;
  /** False once the spring has come to rest on its target. */
  active: boolean;
}

/** Below both of these a spring is at rest. Absolute, in the spring's own units. */
export const springRest = { displacement: 1e-4, speed: 1e-3 } as const;

export const createSpring = (value = 0): Spring => ({
  value,
  velocity: 0,
  target: value,
  params: null,
  active: false,
});

/** The same spring, stopping at its target instead of overshooting. */
export const clamped = (params: SpringParams): SpringParams => ({ ...params, clamp: true });

/**
 * Send a spring towards `target`. The current value and velocity carry over unless a velocity
 * is given, which is how a gesture hands its speed to the spring that takes over from it.
 */
export function springTo(
  spring: Spring,
  target: number,
  params: SpringParams,
  velocity?: number,
): void {
  spring.target = target;
  spring.params = params;
  spring.active = true;
  if (velocity !== undefined) spring.velocity = velocity;
}

/** Put a spring at `value` and stop it. */
export function springSet(spring: Spring, value: number): void {
  spring.value = value;
  spring.target = value;
  spring.velocity = 0;
  spring.active = false;
}

/** Offset from target and velocity after `t` seconds, for a spring starting at (x0, v0). */
export function solveSpring(
  params: SpringParams,
  x0: number,
  v0: number,
  t: number,
): { offset: number; velocity: number } {
  const omega = (2 * Math.PI) / params.response;
  const zeta = params.dampingRatio;
  if (zeta < 1) {
    const wd = omega * Math.sqrt(1 - zeta * zeta);
    const decay = Math.exp(-zeta * omega * t);
    const b = (v0 + zeta * omega * x0) / wd;
    const cos = Math.cos(wd * t);
    const sin = Math.sin(wd * t);
    return {
      offset: decay * (x0 * cos + b * sin),
      velocity: decay * ((b * wd - zeta * omega * x0) * cos - (x0 * wd + zeta * omega * b) * sin),
    };
  }
  if (zeta === 1) {
    const b = v0 + omega * x0;
    const decay = Math.exp(-omega * t);
    return { offset: (x0 + b * t) * decay, velocity: (b - omega * (x0 + b * t)) * decay };
  }
  const root = omega * Math.sqrt(zeta * zeta - 1);
  const r1 = -zeta * omega + root;
  const r2 = -zeta * omega - root;
  const c2 = (v0 - r1 * x0) / (r2 - r1);
  const c1 = x0 - c2;
  const e1 = Math.exp(r1 * t);
  const e2 = Math.exp(r2 * t);
  return { offset: c1 * e1 + c2 * e2, velocity: c1 * r1 * e1 + c2 * r2 * e2 };
}

/** Advance a spring by `dt` seconds. Returns whether it is still moving. */
export function stepSpring(spring: Spring, dt: number): boolean {
  if (!spring.active || !spring.params || !(dt > 0)) return spring.active;
  const x0 = spring.value - spring.target;
  const { offset, velocity } = solveSpring(spring.params, x0, spring.velocity, dt);
  // A clamped spring stops the moment it reaches or crosses its target.
  const crossed =
    spring.params.clamp === true &&
    (offset === 0 || (x0 !== 0 && Math.sign(offset) !== Math.sign(x0)));
  const resting =
    Math.abs(offset) < springRest.displacement && Math.abs(velocity) < springRest.speed;
  if (crossed || resting) {
    spring.value = spring.target;
    spring.velocity = 0;
    spring.active = false;
  } else {
    spring.value = spring.target + offset;
    spring.velocity = velocity;
  }
  return spring.active;
}

/**
 * One semi-implicit Euler step of a spring towards `target`, for values that are pushed around
 * every frame (press light) rather than released towards a rest point.
 */
export function stepRate(
  value: number,
  rate: number,
  target: number,
  params: SpringParams,
  dt: number,
): { value: number; rate: number } {
  const omega = (2 * Math.PI) / params.response;
  const next =
    rate + (omega * omega * (target - value) - 2 * params.dampingRatio * omega * rate) * dt;
  return { value: value + next * dt, rate: next };
}

/**
 * A CSS cubic-bezier timing curve evaluated at progress `x` (0..1), solved by bisection. `steps`
 * bisections give 2^-steps precision in x.
 */
export function cubicBezier(
  [x1, y1, x2, y2]: readonly [number, number, number, number],
  x: number,
  steps = 24,
): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const curve = (s: number, a: number, b: number) => {
    const r = 1 - s;
    return 3 * r * r * s * a + 3 * r * s * s * b + s * s * s;
  };
  let low = 0;
  let high = 1;
  let s = x;
  for (let i = 0; i < steps; i += 1) {
    s = (low + high) / 2;
    if (curve(s, x1, x2) < x) low = s;
    else high = s;
  }
  return curve(s, y1, y2);
}
