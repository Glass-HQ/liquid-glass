import type { GlassMotion } from "./interaction.js";
/** Motion options for native-style value controls. */
export interface ControlMotionOptions {
  /** Override the scene's motion level. */
  motion?: GlassMotion;
  /** Lift the thumb into glass under a press. Default: true. */
  interactive?: boolean;
}
interface Position { value: number; velocity: number }
/** Analytic solution for the measured switch spring (response .47, damping .7). */
function advanceSwitchPosition(position: Position, target: number, dt: number): void {
  const frequency = 2 * Math.PI / 0.47;
  const decayRate = 0.7 * frequency;
  const oscillation = frequency * Math.sqrt(1 - 0.7 ** 2);
  const offset = position.value - target;
  const amplitude = (position.velocity + decayRate * offset) / oscillation;
  const decay = Math.exp(-decayRate * dt);
  const sine = Math.sin(oscillation * dt), cosine = Math.cos(oscillation * dt);
  position.value = target + decay * (offset * cosine + amplitude * sine);
  position.velocity = decay * ((amplitude * oscillation - decayRate * offset) * cosine
    - (decayRate * amplitude + oscillation * offset) * sine);
  if (Math.abs(position.value - target) < 0.001 && Math.abs(position.velocity) < 0.01) {
    position.value = target; position.velocity = 0;
  }
}

const controls = new Map<HTMLElement, { update(now: number): void; active(): boolean }>();
/** Advance visible thumbs before the scene samples their optical geometry.
 * Returns whether any thumb in the scene is still moving. */
export function updateControlMotion(root: HTMLElement, now: number): boolean {
  let active = false;
  for (const [element, control] of controls) {
    if (!root.contains(element)) continue;
    control.update(now);
    if (control.active()) active = true;
  }
  return active;
}

// Samples of the native short-press material envelope, in seconds from pointer down.
const tapEnvelope = [[0, 0], [0.06, 0], [0.087, 0.120633], [0.103, 0.204144],
  [0.120, 0.280965], [0.137, 0.334618], [0.154, 0.353436], [0.170, 0.333683],
  [0.187, 0.281121], [0.204, 0.209108], [0.220, 0.133635], [0.237, 0.068474],
  [0.254, 0.022840], [0.270, 0.001445], [0.287, 0]] as const;
function sampleTap(seconds: number): number {
  for (let i = 1; i < tapEnvelope.length; i++) {
    const [t, p] = tapEnvelope[i]!;
    if (seconds <= t) {
      const [before, value] = tapEnvelope[i - 1]!;
      return value + (p - value) * Math.max(0, (seconds - before) / (t - before));
    }
  }
  return 0;
}
// Invert x for cubic-bezier(.42, 0, .58, 1), the native 200ms interaction curve.
function easeInOut(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  let lo = 0, hi = 1, t = x;
  for (let i = 0; i < 12; i++) {
    const bx = 3 * (1 - t) ** 2 * t * 0.42 + 3 * (1 - t) * t ** 2 * 0.58 + t ** 3;
    if (bx < x) lo = t; else hi = t;
    t = (lo + hi) / 2;
  }
  return 3 * (1 - t) * t * t + t ** 3;
}
/** Controls have their own measured geometry; generic button press scaling must not compound it. */
export function attachNativeControlMotion(element: HTMLElement, motion: GlassMotion, interactive: boolean): () => void {
  const view = element.ownerDocument.defaultView!;
  const preference = view.matchMedia("(prefers-reduced-motion: reduce)");
  const position: Position = { value: 0, velocity: 0 };
  const isSwitch = element.classList.contains("lg-switch-thumb");
  let raf = 0, previous = 0, deadline = 0, pressStart = 0, progress = 0;
  let active = false, pulse = false, initialized = false, targetX = 0, appliedX = 0;
  // The lifted lens stretches along its path in proportion to its speed.
  let lastX: number | undefined, speed = 0;
  let transition = { time: 0, from: 0, to: 0 };
  const full = () => motion === "full" && !preference.matches;
  function tick(now: number) {
    raf = 0;
    const dt = previous ? Math.min((now - previous) / 1000, 0.25) : 1 / 60;
    previous = now;
    const enabled = full();
    const nextActive = interactive && element.dataset.pressPhase === "pressed";
    if (nextActive !== active) {
      active = nextActive;
      if (active) { pressStart = now; pulse = false; }
      else pulse = now - pressStart < 80 && progress < 0.5;
      transition = { time: now, from: progress, to: active ? 1 : 0 };
      deadline = now + 800;
    }
    if (!enabled) progress = active ? 1 : 0;
    else if (pulse) progress = sampleTap((now - pressStart) / 1000);
    else progress = transition.from + (transition.to - transition.from) * easeInOut(Math.min(1, (now - transition.time) / 200));
    element.style.setProperty("--lg-control-progress", String(progress));
    element.dataset.glassMotion = enabled ? "full" : motion === "none" ? "none" : "reduced";
    // Only switch side changes spring. A slider follows its numeric input directly.
    const bounds = element.getBoundingClientRect();
    // The center is unaffected by the stretch scale applied below.
    const nextX = bounds.left + bounds.width / 2 - appliedX;
    if (!initialized || !enabled || !isSwitch) {
      position.value = nextX; position.velocity = 0; initialized = true;
    }
    if (Math.abs(nextX - targetX) > 0.01) deadline = now + 800;
    targetX = nextX;
    if (enabled && isSwitch) advanceSwitchPosition(position, targetX, dt);
    appliedX = position.value - targetX;
    if (isSwitch) element.style.translate = `${appliedX}px 0`;
    const visualX = isSwitch ? position.value : nextX;
    if (lastX !== undefined && dt > 0) speed += ((visualX - lastX) / dt - speed) * Math.min(1, dt * 18);
    lastX = visualX;
    if (!enabled) speed = 0;
    const stretch = Math.min(0.28, Math.abs(speed) * 0.0007) * progress;
    if (stretch > 1e-4) element.style.scale = `${(1 + stretch).toFixed(4)} ${(1 / Math.sqrt(1 + stretch)).toFixed(4)}`;
    else element.style.removeProperty("scale");
    if (Math.abs(speed) > 1) deadline = Math.max(deadline, now + 100);
    if (now < deadline || Math.abs(position.velocity) > 0.01) raf = view.requestAnimationFrame(tick);
    else previous = 0;
  }
  function wake() {
    deadline = performance.now() + 800;
    if (!raf) raf = view.requestAnimationFrame(tick);
  }
  controls.set(element, {
    update(now) {
      if (!raf || previous === now) return;
      view.cancelAnimationFrame(raf);
      tick(now);
    },
    active: () => raf !== 0,
  });
  const observer = new MutationObserver(wake);
  observer.observe(element, { attributes: true, attributeFilter: ["data-press-phase"] });
  if (element.parentElement) observer.observe(element.parentElement, { attributes: true, attributeFilter: ["style", "data-checked", "data-presentation-checked"] });
  preference.addEventListener("change", wake);
  const scroll = () => { initialized = false; wake(); };
  view.addEventListener("scroll", scroll, true);
  wake();
  return () => {
    controls.delete(element);
    view.cancelAnimationFrame(raf); observer.disconnect();
    preference.removeEventListener("change", wake); view.removeEventListener("scroll", scroll, true);
    element.style.removeProperty("--lg-control-progress"); element.style.removeProperty("scale"); if (isSwitch) element.style.removeProperty("translate");
    delete element.dataset.glassMotion;
  };
}
