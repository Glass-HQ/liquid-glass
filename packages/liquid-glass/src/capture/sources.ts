/**
 * Live sources: canvas and video elements whose frames are fed to the worker as they change.
 *
 * Each source owns one bitmap id. A new frame is uploaded under the same id, which the worker
 * writes in place when the size is unchanged (no item update, no repack); a size change
 * recaptures the element so its item's source rect follows. Videos are sampled with
 * `requestVideoFrameCallback` (or every animation frame while playing where that is missing);
 * canvases every animation frame while they are on screen. A frame is only grabbed when the
 * previous one has landed and the element is actually captured.
 */

import type { BitmapStore } from "./bitmaps";
import { bitmapOf, canvasReadable, videoReadable } from "./media";
import type { Resource } from "./types";

interface Binding {
  readonly element: HTMLCanvasElement | HTMLVideoElement;
  readonly resource: Resource;
  /** Bitmap size the capture wants, from the element's size on screen. */
  size: { width: number; height: number } | null;
  busy: boolean;
  stop(): void;
}

export class Sources {
  private readonly bindings = new Map<Element, Binding>();
  private next = 1;

  constructor(
    private readonly store: BitmapStore,
    /** A new frame is queued: the scene should draw. */
    private readonly onFrame: () => void,
    /** The element's capture must be redone (added, removed, resized). */
    private readonly invalidate: (element: Element) => void,
  ) {}

  /** The live resource of an element, telling the source what size to grab at. */
  resourceOf(element: Element, size: { width: number; height: number } | null): Resource | null {
    const binding = this.bindings.get(element);
    if (!binding) return null;
    if (size) binding.size = size;
    return binding.resource;
  }

  add(element: HTMLCanvasElement | HTMLVideoElement): () => void {
    const existing = this.bindings.get(element);
    if (existing) return () => this.remove(element, existing);
    const resource = this.store.owned(`source|${this.next++}`);
    let stopped = false;
    const cleanups: (() => void)[] = [];
    const binding: Binding = {
      element,
      resource,
      size: null,
      busy: false,
      stop: () => {
        stopped = true;
        for (const cleanup of cleanups) cleanup();
      },
    };
    this.bindings.set(element, binding);

    const grab = () => {
      if (stopped || binding.busy) return;
      // Only once the element is drawn somewhere (or is waiting for its first frame).
      if (resource.state === "ready" && resource.refs === 0) return;
      const video = element instanceof HTMLVideoElement ? element : null;
      const natural = video
        ? { width: video.videoWidth, height: video.videoHeight }
        : { width: element.width, height: element.height };
      if (!(natural.width > 0 && natural.height > 0)) return;
      if (
        video
          ? !videoReadable(video) || video.readyState < 2
          : !canvasReadable(element as HTMLCanvasElement)
      )
        return;
      const size = binding.size ?? natural;
      binding.busy = true;
      bitmapOf(element, size.width, size.height).then(
        (image) => {
          binding.busy = false;
          if (!image) return;
          if (stopped) {
            image.close();
            return;
          }
          const resized =
            resource.state === "ready" &&
            (resource.width !== image.width || resource.height !== image.height);
          const first = resource.state !== "ready";
          this.store.replace(resource, image);
          if (resized || first) this.invalidate(element);
          this.onFrame();
        },
        () => {
          binding.busy = false;
        },
      );
    };

    if (element instanceof HTMLVideoElement) {
      if (typeof element.requestVideoFrameCallback === "function") {
        let handle = 0;
        const loop = () => {
          if (stopped) return;
          handle = element.requestVideoFrameCallback(loop);
          grab();
        };
        handle = element.requestVideoFrameCallback(loop);
        cleanups.push(() => element.cancelVideoFrameCallback(handle));
      } else {
        let frame = 0;
        const loop = () => {
          frame = 0;
          if (stopped || element.paused || element.ended) return;
          grab();
          frame = requestAnimationFrame(loop);
        };
        const start = () => {
          if (!frame) frame = requestAnimationFrame(loop);
        };
        element.addEventListener("play", start);
        cleanups.push(() => {
          element.removeEventListener("play", start);
          cancelAnimationFrame(frame);
        });
        start();
      }
      // Paused videos still change frame when seeked or loaded.
      const once = () => grab();
      element.addEventListener("seeked", once);
      element.addEventListener("loadeddata", once);
      cleanups.push(() => {
        element.removeEventListener("seeked", once);
        element.removeEventListener("loadeddata", once);
      });
    } else {
      let frame = 0;
      let visible = true;
      const loop = () => {
        frame = 0;
        if (stopped || !visible) return;
        grab();
        frame = requestAnimationFrame(loop);
      };
      const observer = new IntersectionObserver((entries) => {
        visible = entries.some((entry) => entry.isIntersecting);
        if (visible && !frame) frame = requestAnimationFrame(loop);
      });
      observer.observe(element);
      cleanups.push(() => {
        observer.disconnect();
        cancelAnimationFrame(frame);
      });
      frame = requestAnimationFrame(loop);
    }
    grab();
    this.invalidate(element);
    return () => this.remove(element, binding);
  }

  private remove(element: Element, binding: Binding): void {
    if (this.bindings.get(element) !== binding) return;
    binding.stop();
    this.bindings.delete(element);
    this.store.drop(binding.resource);
    // Back to a still frame.
    this.invalidate(element);
  }

  dispose(): void {
    for (const binding of this.bindings.values()) binding.stop();
    this.bindings.clear();
  }
}
