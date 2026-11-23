/**
 * The frame loop.
 *
 * Everywhere but iOS it is plain requestAnimationFrame: one tick per display frame.
 *
 * On iOS (where `GestureEvent` exists) rAF is held to 60 Hz while the display runs at 120, and
 * the worker's placeholder canvases can present at 120 (`desynchronized`). So the loop runs on
 * MessageChannel + setTimeout instead, phase-locked to an empty rAF loop: rAF timestamps give
 * the display's vsync phase, and ticks are scheduled on a grid of two samples per 120 Hz frame
 * (every 4.17 ms) from that phase, 1 ms early. A tick draws only if 6.25 ms have passed since the
 * last frame (three quarters of a 120 Hz frame, so jitter never skips one), and only while at
 * most two frames are in flight (posted − presented), so the worker never queues stale frames.
 * The empty rAF loop also paces the boost that keeps ProMotion at 120 Hz.
 *
 * With nothing moving for 400 ms the loop parks: no timers, no rAF. It wakes on any request,
 * and an IntersectionObserver tripwire wakes it as soon as the page scrolls. The boost is held
 * for another second after parking, so a quick follow-up gesture starts at 120 Hz.
 */

import { TelemetryCounter, frameGapMs } from "./telemetry";
import type { Telemetry } from "./telemetry";
import type { Boost } from "./ios/boost";
import { createTripwire } from "./tripwire";

export const loop = {
  displayHz: 120,
  samplesPerFrame: 2,
  leadMs: 1,
  /** The boost keeps going this long after the loop parks. */
  holdMs: 1000,
  parkAfterMs: 400,
  framesInFlight: 2,
  /** A step never advances motion by more than this many 120 Hz frames. */
  stepCapFrames: 3,
} as const;

/** 1000 / 120 − (1000 / 120 / 2) / 2 = 6.25 ms. */
export const minFrameMs = 1000 / loop.displayHz - 1000 / loop.displayHz / loop.samplesPerFrame / 2;

/** Time between samples on the iOS grid: 4.17 ms. */
const sampleMs = 1000 / loop.displayHz / loop.samplesPerFrame;

export interface PacerOptions {
  /** True where `GestureEvent` exists: use the phase-locked timer loop and the boost. */
  readonly gesture: boolean;
  readonly boost: Boost | null;
  readonly telemetry: Telemetry;
  /** Read inputs for this tick (controllers). Runs every tick, drawn or not. */
  sample(now: number): void;
  /**
   * `draw`: something changed or is moving, so a frame is due. `awake`: keep ticking even
   * without drawing (a finger is down, the page may still be scrolling).
   */
  wants(now: number): { draw: boolean; awake: boolean };
  /** Frames posted and not yet presented. */
  inFlight(): number;
  /** Draw a frame; `dt` is seconds of motion to advance. Returns whether a frame was posted. */
  draw(now: number, dt: number): boolean;
  /** The loop is parking. */
  park(): void;
}

export interface Pacer {
  wake(): void;
  /** Keep the boost running regardless of motion (a finger is down). */
  pin(pinned: boolean): void;
  readonly running: boolean;
  destroy(): void;
}

export function createPacer(options: PacerOptions): Pacer {
  const { gesture, boost, telemetry } = options;
  const channel = gesture ? new MessageChannel() : null;
  let destroyed = false;
  let running = false;
  let frame = 0;
  let target = 0;
  let activeAt = 0;
  let lastDrawAt = -Infinity;
  let lastStepAt = performance.now();
  let wanted = false;
  // The empty rAF loop on iOS: vsync phase and boost pacing.
  const vsync = { active: false, pinned: false, frame: 0, at: 0, hold: 0 };

  // ------------------------------------------------------------------------------------------
  // Boost and vsync (iOS)
  // ------------------------------------------------------------------------------------------

  const onVsync = (at: number) => {
    if (!vsync.active || destroyed) return;
    vsync.at = at;
    boost?.pace(at);
    vsync.frame = requestAnimationFrame(onVsync);
  };
  const stopVsync = () => {
    window.clearTimeout(vsync.hold);
    cancelAnimationFrame(vsync.frame);
    boost?.rest();
    vsync.active = false;
  };
  const startVsync = () => {
    if (!gesture || destroyed) return;
    window.clearTimeout(vsync.hold);
    if (vsync.active) return;
    vsync.active = true;
    boost?.start();
    boost?.pace(performance.now());
    vsync.frame = requestAnimationFrame(onVsync);
  };
  const holdVsync = () => {
    if (!vsync.active || vsync.pinned) return;
    window.clearTimeout(vsync.hold);
    vsync.hold = window.setTimeout(stopVsync, loop.holdMs);
  };

  // ------------------------------------------------------------------------------------------
  // Ticks
  // ------------------------------------------------------------------------------------------

  const park = () => {
    running = false;
    options.park();
    tripwire?.arm();
    holdVsync();
  };

  const tick = (vsyncAt?: number) => {
    frame = 0;
    if (destroyed || !running) return;
    // On rAF, use the frame's own timestamp: callbacks can run a couple of ms late after other
    // work, and measured by the clock a late tick followed by an on-time one would look closer
    // than 6.25 ms and skip a frame. The timestamps are a whole display frame apart.
    const now = vsyncAt ?? performance.now();
    options.sample(now);
    const { draw: wants, awake } = options.wants(now);
    if (wants && now - lastDrawAt >= minFrameMs && options.inFlight() < loop.framesInFlight) {
      const dt = Math.min(
        Math.max(0, now - lastStepAt) / 1000,
        loop.stepCapFrames / loop.displayHz,
      );
      lastStepAt = now;
      const previous = lastDrawAt;
      lastDrawAt = now;
      if (options.draw(now, dt)) {
        telemetry.tick(TelemetryCounter.frame);
        // A gap only counts while motion was continuous across it.
        if (wanted && now - previous >= frameGapMs && Number.isFinite(previous))
          telemetry.tick(TelemetryCounter.gap, now - previous);
      }
      activeAt = now;
    } else if (!wants && !awake) {
      // Idle time must not count as motion when something starts again.
      lastStepAt = now;
    }
    wanted = wants;
    if (!wants && !awake && now - activeAt > loop.parkAfterMs) park();
    else schedule();
  };

  const schedule = () => {
    if (destroyed) return;
    if (channel) channel.port2.postMessage(0);
    else frame = requestAnimationFrame(tick);
  };

  if (channel) {
    // Round `at` up to the next sample slot on the grid anchored at the last vsync, 1 ms early.
    const slot = (anchor: number, at: number) =>
      anchor + Math.ceil((at - anchor + loop.leadMs) / sampleMs) * sampleMs - loop.leadMs;
    channel.port1.addEventListener("message", () => {
      const now = performance.now();
      target = slot(vsync.at, Math.max(now, target + sampleMs / 2));
      window.setTimeout(() => tick(), Math.max(0, target - now));
    });
    channel.port1.start();
  }

  const tripwire = createTripwire(() => pacer.wake());

  // A hidden page draws nothing; coming back wakes the loop to catch up.
  const onVisibility = () => {
    if (document.visibilityState === "visible") pacer.wake();
    else if (running) {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      running = false;
      stopVsync();
    }
  };
  document.addEventListener("visibilitychange", onVisibility);

  const pacer: Pacer = {
    get running() {
      return running;
    },
    wake() {
      if (destroyed || document.visibilityState === "hidden") return;
      activeAt = performance.now();
      startVsync();
      if (running) return;
      // Parked time is not motion time, and no gap spans it.
      lastStepAt = performance.now();
      wanted = false;
      running = true;
      schedule();
    },
    pin(pinned) {
      vsync.pinned = pinned;
      if (pinned) startVsync();
      else if (!running) holdVsync();
    },
    destroy() {
      destroyed = true;
      running = false;
      if (frame) cancelAnimationFrame(frame);
      stopVsync();
      channel?.port1.close();
      channel?.port2.close();
      tripwire?.destroy();
      document.removeEventListener("visibilitychange", onVisibility);
    },
  };
  return pacer;
}
