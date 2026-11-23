/**
 * Counters for measuring the scene while it runs. Every module ticks named counters (a count and
 * summed milliseconds); once per report interval the totals go to subscribers and start again
 * from zero. The worker keeps its own counters and sends them over; they are merged in under
 * "worker.".
 *
 * Disabled telemetry costs one property read per call: nothing is counted, no timer runs and
 * `time` calls straight through. Marks are the exception: they are recorded once per name
 * whatever the state, so boot phases are on the performance timeline even when the counters
 * are turned on later.
 */

import type { TelemetryCounters } from "../protocol";

export type { TelemetryCounters } from "../protocol";

export interface Telemetry {
  readonly enabled: boolean;
  tick(name: string, ms?: number): void;
  time<T>(name: string, run: () => T): T;
  /** performance.mark once per name. */
  mark(name: string): void;
  merge(counters: TelemetryCounters): void; // the worker's, prefixed "worker."
  subscribe(listener: (report: TelemetryReport) => void): () => void;
  setEnabled(enabled: boolean): void;
}

export interface TelemetryReport {
  readonly at: number;
  readonly intervalMs: number;
  readonly counters: TelemetryCounters;
}

/** The counter names the library ticks. Apps may tick their own next to them. */
export const TelemetryCounter = {
  /** A frame posted to the worker. */
  frame: "page.frame",
  /** Measuring surfaces for a frame (ms). */
  measure: "page.measure",
  /** Capturing DOM into display list patches (ms). */
  capture: "page.capture",
  /** Items captured; `ms` carries the number of items when ticked once per capture. */
  captureItems: "page.capture.items",
  /** A gap of `frameGapMs` or more between frames while something moves. */
  gap: "page.gap",
  /** Optional: ticked once per posted frame with `ms` carrying the frames in flight. */
  inFlight: "page.inflight",
  /** A controller position read. */
  inputSample: "input.sample",
  /** A controller read that differed from the previous one. */
  inputUnique: "input.unique",
  /** A frame the worker presented. */
  workerPresent: "worker.present",
  /** Repainting the display list into the scene texture (ms). */
  workerUnderlay: "worker.underlay",
  /** Downsample and blur (ms). */
  workerFrost: "worker.frost",
  /** The glass shader pass (ms). */
  workerGlass: "worker.glass",
  /** Copying each surface into its placeholder canvas (ms). */
  workerCopy: "worker.copy",
} as const;

/** Frames further apart than this while moving count as a gap. */
export const frameGapMs = 20;

/** How often the worker sends its counters. */
export const workerReportEveryMs = 250;

/** Mark names carry this in `detail.source`, so tools can tell them from the app's own marks. */
export const markSource = "liquid-glass";

const workerPrefix = "worker.";

interface Counter {
  count: number;
  ms: number;
}

/** Every mark is made once per page, however many scenes come and go. */
const marked = new Set<string>();

export function createTelemetry(options: { enabled: boolean; reportEveryMs?: number }): Telemetry {
  const reportEveryMs = options.reportEveryMs ?? 1000;
  const listeners = new Set<(report: TelemetryReport) => void>();
  let counters = new Map<string, Counter>();
  let enabled = options.enabled;
  let timer: ReturnType<typeof setInterval> | undefined;
  let lastReport = 0;

  const add = (name: string, count: number, ms: number): void => {
    const counter = counters.get(name);
    if (counter) {
      counter.count += count;
      counter.ms += ms;
    } else {
      counters.set(name, { count, ms });
    }
  };

  const report = (): void => {
    const now = performance.now();
    const taken: Record<string, { count: number; ms: number }> = {};
    for (const [name, counter] of counters) taken[name] = counter;
    counters = new Map();
    const result: TelemetryReport = { at: now, intervalMs: now - lastReport, counters: taken };
    lastReport = now;
    for (const listener of listeners) listener(result);
  };

  // The timer runs only while counting and someone listens.
  const schedule = (): void => {
    const wanted = enabled && listeners.size > 0;
    if (wanted && timer === undefined) {
      counters = new Map();
      lastReport = performance.now();
      timer = setInterval(report, reportEveryMs);
    } else if (!wanted && timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };

  const telemetry: Telemetry = {
    get enabled() {
      return enabled;
    },
    tick(name, ms = 0) {
      if (!enabled) return;
      add(name, 1, ms);
    },
    time(name, run) {
      if (!enabled) return run();
      const start = performance.now();
      try {
        return run();
      } finally {
        add(name, 1, performance.now() - start);
      }
    },
    mark(name) {
      if (marked.has(name)) return;
      marked.add(name);
      try {
        performance.mark(name, { detail: { source: markSource } });
      } catch {
        // Engines without mark options still record the name.
        performance.mark(name);
      }
    },
    merge(incoming) {
      if (!enabled) return;
      for (const name in incoming) {
        const counter = incoming[name];
        if (!counter) continue;
        add(name.startsWith(workerPrefix) ? name : workerPrefix + name, counter.count, counter.ms);
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      schedule();
      return () => {
        listeners.delete(listener);
        schedule();
      };
    },
    setEnabled(next) {
      if (next === enabled) return;
      enabled = next;
      counters = new Map();
      schedule();
    },
  };
  return telemetry;
}

/** The library's marks so far, in the order they were made, relative to time origin. */
export function telemetryMarks(): { readonly name: string; readonly at: number }[] {
  return performance
    .getEntriesByType("mark")
    .filter((entry) => marked.has(entry.name))
    .map((entry) => ({ name: entry.name, at: entry.startTime }));
}
