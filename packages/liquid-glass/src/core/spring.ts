/** Perceptual spring duration in
 * seconds and bounce from 0 (critically damped) to just under 1. */
export interface SpringOptions {
  duration: number;
  bounce: number;
}

/** Named springs shared by every glass interaction, so motion reads as one material. */
export const springs = {
  /** The material catching a finger or pointer. */
  press: { duration: 0.24, bounce: 0.2 },
  /** Letting go: gel-like overshoot back to rest. */
  release: { duration: 0.5, bounce: 0.42 },
  /** Light settling into and out of the material. */
  glow: { duration: 0.42, bounce: 0 },
  /** Glass growing out of, or back into, another shape. */
  morph: { duration: 0.42, bounce: 0.18 },
  /** A surface flowing to a new layout. */
  layout: { duration: 0.4, bounce: 0.16 },
  /** A selection lens following a drag. */
  track: { duration: 0.18, bounce: 0 },
} as const satisfies Record<string, SpringOptions>;

/** One damped harmonic oscillator. Retargeting keeps the current velocity, so
 * every animation built on it can be interrupted and reversed mid-flight. */
export class Spring {
  value: number;
  velocity = 0;
  target: number;
  private stiffness = 0;
  private damping = 0;
  constructor(value: number, options: SpringOptions) {
    this.value = value;
    this.target = value;
    this.configure(options);
  }
  configure({ duration, bounce }: SpringOptions): this {
    if (!(duration > 0) || !Number.isFinite(duration)) throw new RangeError("Spring duration must be positive and finite.");
    if (!(bounce > -1 && bounce < 1)) throw new RangeError("Spring bounce must be greater than -1 and less than 1.");
    const omega = (2 * Math.PI) / duration;
    this.stiffness = omega * omega;
    this.damping = bounce >= 0 ? 4 * Math.PI * (1 - bounce) / duration : 4 * Math.PI / (duration * (1 + bounce));
    return this;
  }
  /** Move to `value` immediately and stop. */
  jump(value: number): this {
    this.value = this.target = value;
    this.velocity = 0;
    return this;
  }
  get settled(): boolean {
    return this.value === this.target && this.velocity === 0;
  }
  /** Advance by `dt` seconds with the closed-form solution; large frames stay stable. */
  step(dt: number): this {
    if (this.settled || !(dt > 0)) return this;
    const omega = Math.sqrt(this.stiffness);
    const zeta = this.damping / (2 * omega);
    const x0 = this.value - this.target, v0 = this.velocity;
    let x: number, v: number;
    if (zeta < 1) {
      const wd = omega * Math.sqrt(1 - zeta * zeta);
      const decay = Math.exp(-zeta * omega * dt);
      const a = x0, b = (v0 + zeta * omega * x0) / wd;
      const cos = Math.cos(wd * dt), sin = Math.sin(wd * dt);
      x = decay * (a * cos + b * sin);
      v = decay * ((b * wd - zeta * omega * a) * cos - (a * wd + zeta * omega * b) * sin);
    } else if (zeta === 1) {
      const decay = Math.exp(-omega * dt);
      const b = v0 + omega * x0;
      x = decay * (x0 + b * dt);
      v = decay * (b - omega * (x0 + b * dt));
    } else {
      const root = omega * Math.sqrt(zeta * zeta - 1);
      const r1 = -zeta * omega + root, r2 = -zeta * omega - root;
      const c2 = (v0 - r1 * x0) / (r2 - r1), c1 = x0 - c2;
      const e1 = Math.exp(r1 * dt), e2 = Math.exp(r2 * dt);
      x = c1 * e1 + c2 * e2;
      v = c1 * r1 * e1 + c2 * r2 * e2;
    }
    const scale = Math.max(1, Math.abs(this.target), Math.abs(x0));
    if (Math.abs(x) < 1e-4 * scale && Math.abs(v) < 1e-3 * scale) {
      this.value = this.target;
      this.velocity = 0;
    } else {
      this.value = this.target + x;
      this.velocity = v;
    }
    return this;
  }
}

/** Seconds until a spring released from `from` toward `to` with `velocity`
 * comes to rest, or stays within `precision` (a fraction of the travel). */
export function settleTime(options: SpringOptions, from: number, to: number, velocity = 0, precision = 0): number {
  const spring = new Spring(from, options);
  spring.target = to;
  spring.velocity = velocity;
  const tolerance = precision * Math.abs(from - to);
  let time = 0;
  while (!spring.settled && time < 5) {
    if (tolerance && Math.abs(spring.value - to) <= tolerance && Math.abs(spring.velocity) <= tolerance * 10) break;
    spring.step(1 / 120);
    time += 1 / 120;
  }
  return time;
}

/** iOS-style rubber band: follows a short drag, then resists without a hard stop. */
export function rubberBand(offset: number, limit: number, coefficient = 0.55): number {
  if (limit <= 0) return 0;
  const magnitude = Math.abs(offset);
  return Math.sign(offset) * limit * (1 - 1 / (magnitude * coefficient / limit + 1));
}
