import type { BackdropReading, FrameMessage, PageMessage, WorkerMessage } from "../protocol";
import { Renderer, type Timings } from "./renderer";

/**
 * The render worker. It owns one WebGL2 context on its own OffscreenCanvas and the placeholder
 * canvas of every glass surface. It never schedules work of its own: a `frame` message draws
 * (at most every 6.25 ms, so two frames per 120 Hz refresh never queue up), everything else
 * only updates state. Between messages it is idle.
 */

const scope = globalThis as unknown as DedicatedWorkerGlobalScope;

/** Slightly under a 120 Hz period, so timing jitter never makes the worker skip a refresh. */
const MIN_GAP_MS = 6.25;
const TELEMETRY_EVERY_MS = 250;

const CONTEXT = {
  antialias: false,
  alpha: true,
  premultipliedAlpha: true,
  preserveDrawingBuffer: false,
  powerPreference: "high-performance",
  depth: false,
  stencil: false,
} as const;

let renderer: Renderer | null = null;
let canvas: OffscreenCanvas | null = null;
let desynchronized = false;
let telemetry = false;
let latest: FrameMessage | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let lastDraw = -Infinity;
/**
 * The browser presents placeholder canvases in tasks of its own after a frame's task (WebKit
 * copies each canvas there), invisible to the timings above. A message posted at the end of a
 * frame is handled once those are done: its delay is `worker.commit`.
 */
const commitProbe = new MessageChannel();
commitProbe.port1.onmessage = (event: MessageEvent<number>) =>
  count("worker.commit", performance.now() - event.data);
const reported = new Set<string>();

const counters = new Map<string, { count: number; ms: number }>();
let telemetryTimer: ReturnType<typeof setTimeout> | undefined;

/** How often to look for finished backdrop readbacks while any are pending. */
const READBACK_POLL_MS = 4;
/** A reading is sent again only once it moves this much (0..1), so a still page stays quiet. */
const READING_STEP = 0.02;
let readbackTimer: ReturnType<typeof setTimeout> | undefined;
const lastReadings = new Map<number, BackdropReading>();

/**
 * Send backdrop readings the GPU has finished, then keep polling (briefly) while more are on
 * their way. Readings that barely moved since the last one sent for that surface are dropped.
 */
function pollReadings(): void {
  readbackTimer = undefined;
  if (!renderer || renderer.lost) return;
  const fresh: BackdropReading[] = [];
  for (const reading of renderer.readings()) {
    const last = lastReadings.get(reading.id);
    if (
      last &&
      Math.abs(last.luma - reading.luma) < READING_STEP &&
      Math.abs(last.contrast - reading.contrast) < READING_STEP &&
      Math.abs(last.bright - reading.bright) < READING_STEP &&
      Math.abs(last.detail - reading.detail) < READING_STEP
    )
      continue;
    lastReadings.set(reading.id, reading);
    fresh.push(reading);
  }
  if (fresh.length) post({ type: "backdrop", readings: fresh });
  if (renderer.measuring) readbackTimer = setTimeout(pollReadings, READBACK_POLL_MS);
}

function post(message: WorkerMessage): void {
  scope.postMessage(message);
}

function fail(message: string): void {
  if (reported.has(message)) return;
  reported.add(message);
  post({ type: "error", message });
}

function start(options: { desynchronized: boolean; telemetry: boolean }): void {
  desynchronized = options.desynchronized;
  telemetry = options.telemetry;
  if (typeof OffscreenCanvas === "undefined") {
    fail("OffscreenCanvas is not available in workers here, so glass cannot be drawn");
    return;
  }
  canvas = new OffscreenCanvas(256, 256);
  const gl = canvas.getContext("webgl2", { ...CONTEXT, desynchronized });
  if (!gl) {
    fail("WebGL2 is not available in workers here, so glass cannot be drawn");
    return;
  }
  canvas.addEventListener("webglcontextlost", (event) => {
    // Without preventDefault the context would never be restored.
    event.preventDefault();
    renderer?.lose();
  });
  canvas.addEventListener("webglcontextrestored", () => {
    const restored = canvas?.getContext("webgl2", { ...CONTEXT, desynchronized }) ?? null;
    if (!renderer || !restored) return;
    try {
      renderer.restore(restored);
    } catch (error) {
      fail(messageOf(error));
      return;
    }
    // Draw the last frame again so every surface shows its glass without waiting for motion.
    if (lastFrame) {
      latest = lastFrame;
      schedule();
    }
  });
  try {
    renderer = new Renderer(canvas, gl, desynchronized);
  } catch (error) {
    fail(messageOf(error));
    return;
  }
  post({ type: "ready" });
}

/** The last frame drawn, kept to redraw after a restored context. */
let lastFrame: FrameMessage | null = null;

function schedule(): void {
  if (timer) return;
  const wait = lastDraw + MIN_GAP_MS - performance.now();
  if (wait <= 0) {
    draw();
    return;
  }
  timer = setTimeout(() => {
    timer = undefined;
    draw();
  }, wait);
}

function draw(): void {
  const frame = latest;
  latest = null;
  if (!frame) return;
  const started = performance.now();
  lastDraw = started;
  lastFrame = frame;
  let timings: Timings | null = null;
  if (renderer && !renderer.lost) {
    try {
      timings = renderer.render(frame);
    } catch (error) {
      fail(messageOf(error));
    }
  }
  if (renderer?.measuring && !readbackTimer)
    readbackTimer = setTimeout(pollReadings, READBACK_POLL_MS);
  // Answer even when nothing could be drawn, so the page never waits on frames in flight.
  post({
    type: "presented",
    sequence: frame.sequence,
    at: performance.timeOrigin + performance.now(),
  });
  if (telemetry) {
    commitProbe.port2.postMessage(performance.now());
    count("worker.present", performance.now() - started);
    if (timings) {
      count("worker.underlay", timings.underlay);
      count("worker.frost", timings.frost);
      count("worker.glass", timings.glass, timings.surfaces);
      count("worker.copy", timings.copy, timings.surfaces);
      // Counts only: placeholders redrawn in part, and kilopixels redrawn.
      if (timings.partial) count("worker.partial", 0, timings.partial);
      count("worker.kpx", 0, Math.round(timings.pixels / 1000));
    }
    if (!telemetryTimer) telemetryTimer = setTimeout(report, TELEMETRY_EVERY_MS);
  }
}

function count(name: string, ms: number, times = 1): void {
  const entry = counters.get(name);
  if (entry) {
    entry.count += times;
    entry.ms += ms;
  } else counters.set(name, { count: times, ms });
}

function report(): void {
  telemetryTimer = undefined;
  if (!counters.size) return;
  const out: Record<string, { count: number; ms: number }> = {};
  for (const [name, entry] of counters) out[name] = { count: entry.count, ms: entry.ms };
  counters.clear();
  post({ type: "telemetry", counters: out });
}

function dispose(): void {
  if (timer) clearTimeout(timer);
  if (telemetryTimer) clearTimeout(telemetryTimer);
  if (readbackTimer) clearTimeout(readbackTimer);
  renderer?.dispose();
  renderer = null;
  canvas = null;
  scope.close();
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

scope.addEventListener("message", (event: MessageEvent<PageMessage>) => {
  const message = event.data;
  switch (message.type) {
    case "start":
      start(message);
      return;
    case "attach":
      renderer?.attach(message.surface, message.canvas);
      return;
    case "detach":
      renderer?.detach(message.surface);
      lastReadings.delete(message.surface);
      return;
    case "display":
      if (renderer) renderer.display(message.patch);
      else for (const upload of message.patch.bitmaps) upload.image.close();
      return;
    case "frame":
      latest = message;
      schedule();
      return;
    case "dispose":
      dispose();
      return;
  }
});
