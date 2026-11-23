/**
 * Tracks animations that can move a glass surface: those running on a surface or on any element
 * containing one (a dialog scaling in, a sheet sliding up). While any runs, every frame
 * re-measures every surface; otherwise their last measurement is reused.
 *
 * CSS transitions and animations announce themselves with events. Animations started from
 * script (`element.animate()`, and libraries built on it) don't, so they are looked up with
 * `document.getAnimations()`: on every frame while the scene's loop runs (at most once per
 * 3 ms, from `active`), and once after each press, click or key while it is parked, since that
 * is what starts them. A parked scene with no input does nothing.
 *
 * Animations inside a surface don't move it; the capture handles what they repaint.
 */

export interface Activity {
  /** Whether anything that may move a surface is running. Call it from the frame loop. */
  readonly active: boolean;
  destroy(): void;
}

/** Script animations are looked up at most this often (ms), however often `active` is read. */
const SCAN_EVERY_MS = 3;

export function createActivity(doc: Document, onChange: () => void): Activity {
  const running = new Map<Element, Set<string>>();
  /** Script animations that move a surface and were running at the last scan. */
  const scripted = new Set<Animation>();
  /** Whether each script animation seen so far moves a surface (its target doesn't change). */
  const seen = new WeakMap<Animation, boolean>();
  const abort = new AbortController();
  const options = { capture: true, passive: true, signal: abort.signal } as const;
  let scannedAt = -Infinity;
  let inputFrame = 0;

  const moves = (target: Element) =>
    !target.closest("[data-lg-ignore]") &&
    (target.hasAttribute("data-lg-surface") || target.querySelector("[data-lg-surface]") !== null);

  const start = (target: EventTarget | null, name: string) => {
    if (!(target instanceof Element) || !moves(target)) return;
    let names = running.get(target);
    if (!names) {
      names = new Set();
      running.set(target, names);
    }
    names.add(name);
    onChange();
  };
  const stop = (target: EventTarget | null, name: string) => {
    if (!(target instanceof Element)) return;
    const names = running.get(target);
    if (!names) return;
    names.delete(name);
    if (names.size === 0) running.delete(target);
    // One more frame at the final place.
    onChange();
  };

  const settle = (animation: Animation) => {
    if (!scripted.delete(animation)) return;
    // One more frame at the final place.
    onChange();
  };

  /** Look for script animations that move surfaces. Returns whether a new one was found. */
  const scan = (): boolean => {
    scannedAt = performance.now();
    if (typeof doc.getAnimations !== "function") return false;
    let found = false;
    for (const animation of doc.getAnimations()) {
      // CSS animations and transitions are tracked by their events.
      if ("animationName" in animation || "transitionProperty" in animation) continue;
      if (animation.playState !== "running" || scripted.has(animation)) continue;
      let moving = seen.get(animation);
      if (moving === undefined) {
        const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
        moving = target !== null && moves(target);
        seen.set(animation, moving);
        if (moving) {
          const done = () => settle(animation);
          animation.addEventListener("finish", done);
          animation.addEventListener("cancel", done);
          animation.addEventListener("remove", done);
        }
      }
      if (!moving) continue;
      scripted.add(animation);
      found = true;
    }
    // Paused ones and ones whose element left the page stop counting.
    for (const animation of scripted) {
      const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
      if (animation.playState !== "running" || !target?.isConnected) scripted.delete(animation);
    }
    return found;
  };

  doc.addEventListener("transitionrun", (e) => start(e.target, `t:${e.propertyName}`), options);
  doc.addEventListener("transitionend", (e) => stop(e.target, `t:${e.propertyName}`), options);
  doc.addEventListener("transitioncancel", (e) => stop(e.target, `t:${e.propertyName}`), options);
  doc.addEventListener("animationstart", (e) => start(e.target, `a:${e.animationName}`), options);
  doc.addEventListener("animationend", (e) => stop(e.target, `a:${e.animationName}`), options);
  doc.addEventListener("animationcancel", (e) => stop(e.target, `a:${e.animationName}`), options);

  // Input is what starts script animations while nothing else moves: look once, the frame after.
  const onInput = () => {
    if (inputFrame) return;
    inputFrame = requestAnimationFrame(() => {
      inputFrame = 0;
      if (performance.now() - scannedAt >= SCAN_EVERY_MS && scan()) onChange();
    });
  };
  for (const type of ["pointerdown", "pointerup", "click", "keydown"] as const)
    doc.addEventListener(type, onInput, options);

  return {
    get active() {
      if (performance.now() - scannedAt >= SCAN_EVERY_MS) scan();
      if (running.size === 0) return scripted.size > 0;
      // Elements removed mid-animation never send an end event.
      for (const element of running.keys()) if (!element.isConnected) running.delete(element);
      return running.size > 0 || scripted.size > 0;
    },
    destroy() {
      abort.abort();
      cancelAnimationFrame(inputFrame);
      running.clear();
      scripted.clear();
    },
  };
}
