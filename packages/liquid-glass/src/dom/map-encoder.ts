import { encodeMapPixels } from "./map-encoding.js";

let worker: Worker | undefined;
let unavailable = false;
let starting: Promise<Worker | undefined> | undefined;
let sequence = 0;
const pending = new Map<number, { resolve: (planes: string[][]) => void; reject: (error: Error) => void }>();

async function encoder(): Promise<Worker | undefined> {
  if (unavailable) return;
  if (worker) return worker;
  return starting ??= import("./map-encoder.worker.ts?worker&inline").then(({ default: EncoderWorker }) => {
    worker = new EncoderWorker();
    worker.onmessage = ({ data: { id, planes, error } }) => {
      const request = pending.get(id);
      pending.delete(id);
      if (error) request?.reject(new Error(error));
      else request?.resolve(planes);
    };
    const failed = () => {
      unavailable = true;
      worker?.terminate();
      worker = undefined;
      for (const request of pending.values()) request.reject(new Error("Material encoder worker unavailable."));
      pending.clear();
    };
    worker.onerror = (event) => { event.preventDefault(); failed(); };
    worker.onmessageerror = failed;
    return worker;
  }).catch(() => { unavailable = true; return undefined; });
}

/** Encode map planes (and capsule slices) to `data:` URLs on a worker, so the
 * main thread never compresses images. Without workers (including under a
 * restrictive CSP) the identical encoder runs locally. The pixels are copied
 * for the worker, so they remain available for that fallback. */
export async function encodeMaterialPixels(pixels: Uint8Array, width: number, height: number, cap?: number): Promise<string[][]> {
  const target = await encoder();
  if (target) {
    try {
      return await new Promise<string[][]>((resolve, reject) => {
        const id = ++sequence;
        pending.set(id, { resolve, reject });
        try {
          target.postMessage({ id, pixels, width, height, cap });
        } catch (error) {
          pending.delete(id);
          reject(error);
        }
      });
    } catch { /* Preserve the same pixels when a worker cannot run. */ }
  }
  return encodeMapPixels(pixels, width, height, cap);
}
