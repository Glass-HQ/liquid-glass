/**
 * Every bitmap the capture sends: text runs, icons, images, gradients and live frames. Bitmaps
 * are shared by a content key and reference-counted by the items drawing them. When the last
 * item lets go, a bitmap that took a decode to make (an image, an icon) is kept a little longer
 * within a pixel budget, so one that comes back after a re-render or a scroll shows at once;
 * bitmaps drawn synchronously (text runs, gradients) are released straight away, since a text
 * line that changed rarely comes back and drawing it again costs microseconds.
 *
 * Uploads and releases queue up here and leave with the next patch. A bitmap released before it
 * was ever sent is closed locally and never mentioned to the worker.
 */

import type { BitmapUpload } from "../protocol";
import { isSnapshot } from "./snapshot";
import type { Resource } from "./types";

/** Pixels of unused bitmaps kept for reuse before the oldest is released. */
const IDLE_PIXELS = 8 * 1024 * 1024;
const IDLE_COUNT = 512;

export class BitmapStore {
  private readonly byKey = new Map<string, Resource>();
  /** Unused, ready resources in least-recently-used order. */
  private readonly idle = new Set<Resource>();
  private idlePixels = 0;
  private nextId = 1;
  private uploads = new Map<number, ImageBitmap>();
  private releases: number[] = [];
  /** Bitmap ids the worker has received. */
  private readonly sent = new Set<number>();
  private disposed = false;

  constructor(private readonly onReady: (resource: Resource) => void) {}

  get(key: string): Resource | undefined {
    const resource = this.byKey.get(key);
    if (resource && this.idle.delete(resource)) this.idlePixels -= resource.width * resource.height;
    return resource;
  }

  private create(key: string, owned: boolean, keep: boolean): Resource {
    const resource: Resource = {
      key,
      keep,
      bitmap: this.nextId++,
      state: "pending",
      width: 0,
      height: 0,
      refs: 0,
      waiting: new Set(),
      owned,
      meta: null,
      generation: 0,
    };
    if (!owned) this.byKey.set(key, resource);
    return resource;
  }

  /** A resource whose bitmap is ready now. */
  putSync(key: string, image: ImageBitmap): Resource {
    const resource = this.create(key, false, false);
    this.ready(resource, image);
    return resource;
  }

  /** A resource produced later; items drawing it wait until it is ready. */
  putAsync(key: string, produce: () => Promise<ImageBitmap | null>): Resource {
    const resource = this.create(key, false, true);
    produce().then(
      (image) => {
        if (!image) return this.fail(resource);
        if (this.disposed || this.byKey.get(key) !== resource) {
          image.close();
          return;
        }
        this.ready(resource, image);
        this.onReady(resource);
      },
      () => this.fail(resource),
    );
    return resource;
  }

  /** A resource owned by its creator (a live source): never shared, never freed by refs. */
  owned(key: string): Resource {
    return this.create(key, true, false);
  }

  /** Replace an owned resource's bitmap (a new video frame). */
  replace(resource: Resource, image: ImageBitmap): void {
    if (this.disposed) {
      image.close();
      return;
    }
    const wasReady = resource.state === "ready";
    const resized = resource.width !== image.width || resource.height !== image.height;
    this.ready(resource, image);
    if (resized && wasReady) resource.generation += 1;
    if (!wasReady || resized) this.onReady(resource);
  }

  private ready(resource: Resource, image: ImageBitmap): void {
    resource.state = "ready";
    resource.width = image.width;
    resource.height = image.height;
    const previous = this.uploads.get(resource.bitmap);
    if (previous && previous !== image) previous.close();
    this.uploads.set(resource.bitmap, image);
  }

  private fail(resource: Resource): void {
    resource.state = "failed";
    resource.waiting.clear();
  }

  acquire(resource: Resource): void {
    resource.refs += 1;
    if (resource.refs === 1 && this.idle.delete(resource))
      this.idlePixels -= resource.width * resource.height;
  }

  release(resource: Resource): void {
    resource.refs -= 1;
    if (resource.refs > 0 || resource.owned) return;
    resource.refs = 0;
    if (resource.state === "failed") {
      this.byKey.delete(resource.key);
      return;
    }
    if (!resource.keep) {
      this.free(resource);
      return;
    }
    this.idle.add(resource);
    this.idlePixels += resource.width * resource.height;
    this.trim(IDLE_PIXELS, IDLE_COUNT);
  }

  /** Release unused bitmaps down to a budget. */
  trim(pixels: number, count: number): void {
    for (const resource of this.idle) {
      if (this.idlePixels <= pixels && this.idle.size <= count) break;
      this.idle.delete(resource);
      this.idlePixels -= resource.width * resource.height;
      this.free(resource);
    }
  }

  /** Free an owned resource's bitmap. */
  drop(resource: Resource): void {
    this.free(resource);
  }

  private free(resource: Resource): void {
    if (this.byKey.get(resource.key) === resource) this.byKey.delete(resource.key);
    resource.waiting.clear();
    const pending = this.uploads.get(resource.bitmap);
    if (pending) {
      pending.close();
      this.uploads.delete(resource.bitmap);
    }
    if (this.sent.delete(resource.bitmap)) this.releases.push(resource.bitmap);
    resource.state = "failed";
  }

  hasPending(): boolean {
    return this.uploads.size > 0 || this.releases.length > 0;
  }

  /** Everything queued for the next patch. */
  take(): { bitmaps: BitmapUpload[]; transfer: ImageBitmap[]; releases: number[] } {
    const bitmaps: BitmapUpload[] = [];
    const transfer: ImageBitmap[] = [];
    for (const [id, image] of this.uploads) {
      bitmaps.push({ id, image, snapshot: isSnapshot(image) });
      transfer.push(image);
      this.sent.add(id);
    }
    this.uploads = new Map();
    const releases = this.releases;
    this.releases = [];
    return { bitmaps, transfer, releases };
  }

  dispose(): void {
    this.disposed = true;
    for (const image of this.uploads.values()) image.close();
    this.uploads.clear();
    this.byKey.clear();
    this.idle.clear();
  }
}
