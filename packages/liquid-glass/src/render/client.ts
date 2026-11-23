import type {
  BackdropReading,
  DisplayListPatch,
  FrameMessage,
  PageMessage,
  WorkerMessage,
} from "../protocol";
import type { Telemetry } from "../scene/telemetry";
import RenderWorker from "./worker.ts?worker&inline";

export interface RenderClient {
  attach(surface: number, canvas: HTMLCanvasElement): void;
  detach(surface: number): void;
  display(patch: DisplayListPatch, transfer: Transferable[]): void;
  frame(frame: Omit<FrameMessage, "type">): void;
  /** Frames posted and not yet presented. */
  inFlight(): number;
  onPresented(listener: (sequence: number, at: number) => void): () => void;
  /** What the worker measured behind surfaces it redrew (only readings that moved). */
  onBackdrop(listener: (readings: readonly BackdropReading[]) => void): () => void;
  dispose(): void;
}

/**
 * The page's side of the render worker. It starts the worker, hands it each surface's canvas
 * and forwards display list patches and frames. It counts frames posted against frames
 * presented so the pacer can keep at most a couple in flight.
 *
 * When the worker cannot draw (no OffscreenCanvas, no WebGL2 in workers, a shader that fails),
 * `onError` is called once and the client goes quiet: frames are dropped and nothing is ever
 * in flight, so the scene can show its fallback without stalling.
 */
export function createRenderClient(options: {
  desynchronized: boolean;
  telemetry: Telemetry;
  onError(message: string): void;
}): RenderClient {
  const listeners = new Set<(sequence: number, at: number) => void>();
  const backdropListeners = new Set<(readings: readonly BackdropReading[]) => void>();
  /** Sequences posted and not yet presented, oldest first. The worker may skip some. */
  const pending: number[] = [];
  let worker: Worker | null = null;
  let failed = false;

  const fail = (message: string) => {
    if (failed) return;
    failed = true;
    pending.length = 0;
    worker?.terminate();
    worker = null;
    options.onError(message);
  };

  const post = (message: PageMessage, transfer: Transferable[] = []) => {
    if (!worker || failed) return false;
    worker.postMessage(message, transfer);
    return true;
  };

  const supported =
    typeof Worker !== "undefined" &&
    typeof OffscreenCanvas !== "undefined" &&
    typeof HTMLCanvasElement !== "undefined" &&
    "transferControlToOffscreen" in HTMLCanvasElement.prototype;

  if (!supported) {
    // Reported after this call returns, so the caller has its handlers in place.
    queueMicrotask(() =>
      fail(
        "This browser cannot hand canvases to a worker (OffscreenCanvas), so glass cannot be drawn",
      ),
    );
  } else {
    try {
      const created = new RenderWorker({ name: "liquid-glass" });
      worker = created;
      created.addEventListener("message", (event: MessageEvent<WorkerMessage>) => {
        const message = event.data;
        switch (message.type) {
          case "presented": {
            while (pending.length && (pending[0] ?? Infinity) <= message.sequence) pending.shift();
            // The worker stamps time on its own clock; bring it onto the page's.
            const at = message.at - performance.timeOrigin;
            for (const listener of listeners) listener(message.sequence, at);
            return;
          }
          case "backdrop":
            for (const listener of backdropListeners) listener(message.readings);
            return;
          case "telemetry":
            if (options.telemetry.enabled) options.telemetry.merge(message.counters);
            return;
          case "error":
            fail(message.message);
            return;
          case "ready":
            return;
        }
      });
      created.addEventListener("error", (event) => {
        event.preventDefault();
        fail(event.message || "The glass worker failed to start");
      });
      // Telemetry is always collected; the page drops it while its telemetry is off, so turning
      // it on later needs no message.
      post({ type: "start", desynchronized: options.desynchronized, telemetry: true });
    } catch (error) {
      queueMicrotask(() => fail(error instanceof Error ? error.message : String(error)));
    }
  }

  return {
    attach(surface, canvas) {
      if (!worker || failed) return;
      let offscreen: OffscreenCanvas;
      try {
        offscreen = canvas.transferControlToOffscreen();
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
        return;
      }
      post({ type: "attach", surface, canvas: offscreen }, [offscreen]);
    },
    detach(surface) {
      post({ type: "detach", surface });
    },
    display(patch, transfer) {
      if (!post({ type: "display", patch }, transfer)) {
        // Nobody will draw them: free the bitmaps now.
        for (const upload of patch.bitmaps) upload.image.close();
      }
    },
    frame(frame) {
      if (post({ type: "frame", ...frame })) pending.push(frame.sequence);
    },
    inFlight() {
      return pending.length;
    },
    onPresented(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onBackdrop(listener) {
      backdropListeners.add(listener);
      return () => backdropListeners.delete(listener);
    },
    dispose() {
      post({ type: "dispose" });
      worker = null;
      failed = true;
      pending.length = 0;
      listeners.clear();
      backdropListeners.clear();
    },
  };
}
