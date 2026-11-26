import { type GL, compileProgram, setSampling } from "./gl";

/**
 * Bitmaps live in a few large RGBA8 pages, packed in shelves, so a whole page of text runs and
 * icons draws with one texture bound. Every ImageBitmap is kept until the page releases it:
 * a lost context or a repack re-uploads from them.
 *
 * Bitmaps should arrive premultiplied (`createImageBitmap(..., { premultiplyAlpha: "premultiply" })`):
 * WebGL ignores the unpack premultiply flag for ImageBitmaps and uploads them as they are. A
 * snapshot of a 2D canvas (`transferToImageBitmap`) is premultiplied in Chromium and Gecko but
 * uploads with straight alpha in WebKit; there it is premultiplied on the GPU as it is placed.
 */

const PREMULTIPLY_VERTEX = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;
const PREMULTIPLY_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uImage;
uniform vec2 uOrigin;
out vec4 color;
void main() {
  vec4 c = texelFetch(uImage, ivec2(gl_FragCoord.xy - uOrigin), 0);
  color = vec4(c.rgb * c.a, c.a);
}`;

/**
 * Shared pages are made as they fill, each larger than the last up to the largest: a scene with
 * little under its glass holds a 4 MB page, not a 64 MB one. The limit keeps the room there was
 * with four of the largest.
 */
const PAGE_SIZES = [1024, 2048, 4096] as const;
const PAGE_LIMIT = 6;
/** Empty space between bitmaps, so linear filtering at an edge never reads a neighbour. */
const GAP = 1;

export interface Placement {
  readonly page: number;
  /** Texel position of the bitmap's top-left in its page. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Size of the page, for normalising texel coordinates. */
  readonly pageWidth: number;
  readonly pageHeight: number;
}

interface Entry {
  image: ImageBitmap;
  placement: Placement | null;
  snapshot: boolean;
}

interface Shelf {
  y: number;
  height: number;
  x: number;
}

interface Page {
  texture: WebGLTexture;
  width: number;
  height: number;
  shelves: Shelf[];
  /** Height used by shelves so far. */
  top: number;
  /** A page made for one bitmap larger than a shared page. */
  dedicated: boolean;
}

export class Atlas {
  private readonly entries = new Map<number, Entry>();
  private pages: (Page | null)[] = [];
  private pageSize: number;
  private maxSize: number;
  /** Area of released bitmaps still occupying shelves; a repack reclaims it. */
  private dead = 0;
  /** Bumped whenever a placement is made or moves, so instance data that baked texel coordinates is rebuilt. */
  generation = 0;
  /** Bitmaps that could not be placed (too large or out of pages); reported once each. */
  readonly dropped = new Set<number>();

  /** Whether this engine uploads canvas snapshots with straight alpha; probed on first use. */
  private straightSnapshots: boolean | null = null;
  private premultiplier: {
    program: WebGLProgram;
    origin: WebGLUniformLocation | null;
    image: WebGLUniformLocation | null;
    scratch: WebGLTexture;
    framebuffer: WebGLFramebuffer;
  } | null = null;

  constructor(private gl: GL) {
    this.maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    this.pageSize = Math.min(4096, this.maxSize);
  }

  get(id: number): Placement | null {
    return this.entries.get(id)?.placement ?? null;
  }

  texture(page: number): WebGLTexture | null {
    return this.pages[page]?.texture ?? null;
  }

  /** Add or replace a bitmap. A replacement of the same size is written in place (video frames). */
  put(id: number, image: ImageBitmap, snapshot = false): void {
    const existing = this.entries.get(id);
    if (existing) {
      const place = existing.placement;
      if (existing.image !== image) existing.image.close();
      existing.image = image;
      existing.snapshot = snapshot;
      if (place && place.width === image.width && place.height === image.height) {
        this.upload(place, image, snapshot);
        return;
      }
      if (place) this.free(place);
      existing.placement = this.place(id, image, snapshot);
      return;
    }
    this.entries.set(id, { image, snapshot, placement: this.place(id, image, snapshot) });
  }

  release(id: number): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.image.close();
    if (entry.placement) this.free(entry.placement);
    this.entries.delete(id);
    this.dropped.delete(id);
  }

  /**
   * Give back the pages that released bitmaps left mostly empty. A shelf never takes a bitmap
   * again once its own was released, so content scrolling under glass (captured, then released
   * as it leaves) fills page after page with holes. Once more than half of what the pages hold is
   * holes, everything is packed again into as few pages as it needs. Returns whether it was.
   */
  compact(): boolean {
    let capacity = 0;
    let smallest = Infinity;
    for (const page of this.pages) {
      if (!page || page.dedicated) continue;
      capacity += page.width * page.height;
      smallest = Math.min(smallest, page.width * page.height);
    }
    if (capacity <= smallest || this.dead < capacity / 2) return false;
    this.repack();
    return true;
  }

  /** After a context restore: new pages, every retained bitmap uploaded again. */
  restore(gl: GL): void {
    this.gl = gl;
    this.maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    this.pageSize = Math.min(4096, this.maxSize);
    this.pages = [];
    this.premultiplier = null;
    this.repack();
  }

  dispose(): void {
    for (const page of this.pages) if (page) this.gl.deleteTexture(page.texture);
    if (this.premultiplier) {
      this.gl.deleteProgram(this.premultiplier.program);
      this.gl.deleteTexture(this.premultiplier.scratch);
      this.gl.deleteFramebuffer(this.premultiplier.framebuffer);
      this.premultiplier = null;
    }
    for (const entry of this.entries.values()) entry.image.close();
    this.pages = [];
    this.entries.clear();
  }

  private place(id: number, image: ImageBitmap, snapshot: boolean): Placement | null {
    const width = image.width;
    const height = image.height;
    if (width === 0 || height === 0) return null;
    let placed = this.allocate(width, height);
    if (!placed && this.dead > 0) {
      // Out of room with holes left by released bitmaps: pack everything again, tightly.
      this.repack(id);
      placed = this.allocate(width, height);
    }
    if (!placed) {
      this.dropped.add(id);
      return null;
    }
    this.upload(placed, image, snapshot);
    this.generation += 1;
    return placed;
  }

  private allocate(width: number, height: number): Placement | null {
    if (width > this.maxSize || height > this.maxSize) return null;
    if (width + GAP > this.pageSize || height + GAP > this.pageSize)
      return this.dedicate(width, height);
    for (let index = 0; index < this.pages.length; index += 1) {
      const page = this.pages[index];
      if (!page || page.dedicated) continue;
      const spot = shelfFit(page, width + GAP, height + GAP);
      if (spot)
        return {
          page: index,
          x: spot[0],
          y: spot[1],
          width,
          height,
          pageWidth: page.width,
          pageHeight: page.height,
        };
    }
    const shared = this.sharedPages();
    if (shared >= PAGE_LIMIT) return null;
    // The next size up, or larger when this bitmap needs it.
    const step = PAGE_SIZES[Math.min(shared, PAGE_SIZES.length - 1)] ?? this.pageSize;
    let size = Math.min(step, this.pageSize);
    while (size < this.pageSize && (width + GAP > size || height + GAP > size)) size *= 2;
    size = Math.min(size, this.pageSize);
    const index = this.addPage(size, size, false);
    const page = this.pages[index];
    const spot = page ? shelfFit(page, width + GAP, height + GAP) : null;
    if (!page || !spot) return null;
    return {
      page: index,
      x: spot[0],
      y: spot[1],
      width,
      height,
      pageWidth: page.width,
      pageHeight: page.height,
    };
  }

  private dedicate(width: number, height: number): Placement {
    const index = this.addPage(width, height, true);
    return { page: index, x: 0, y: 0, width, height, pageWidth: width, pageHeight: height };
  }

  private sharedPages(): number {
    return this.pages.filter((page) => page && !page.dedicated).length;
  }

  private addPage(width: number, height: number, dedicated: boolean): number {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height);
    setSampling(gl, gl.LINEAR);
    const page: Page = { texture, width, height, shelves: [], top: 0, dedicated };
    const free = this.pages.indexOf(null);
    if (free >= 0) {
      this.pages[free] = page;
      return free;
    }
    this.pages.push(page);
    return this.pages.length - 1;
  }

  private free(place: Placement): void {
    const page = this.pages[place.page];
    if (!page) return;
    if (page.dedicated) {
      this.gl.deleteTexture(page.texture);
      this.pages[place.page] = null;
      return;
    }
    this.dead += (place.width + GAP) * (place.height + GAP);
  }

  /** Re-place every bitmap, tallest first, into fresh pages. `skip` is placed by the caller. */
  private repack(skip?: number): void {
    const gl = this.gl;
    for (const page of this.pages) if (page) gl.deleteTexture(page.texture);
    this.pages = [];
    this.dead = 0;
    this.generation += 1;
    const order = [...this.entries]
      .filter(([id]) => id !== skip)
      .sort(([, a], [, b]) => b.image.height - a.image.height);
    for (const [id, entry] of order) {
      entry.placement = null;
      const placed = this.allocate(entry.image.width, entry.image.height);
      if (!placed) {
        this.dropped.add(id);
        continue;
      }
      this.dropped.delete(id);
      entry.placement = placed;
      this.upload(placed, entry.image, entry.snapshot);
    }
    const skipped = skip === undefined ? undefined : this.entries.get(skip);
    if (skipped) skipped.placement = null;
  }

  private upload(place: Placement, image: ImageBitmap, snapshot: boolean): void {
    const gl = this.gl;
    const page = this.pages[place.page];
    if (!page) return;
    if (snapshot && this.straight()) {
      this.premultiplied(page.texture, place, image);
      return;
    }
    gl.bindTexture(gl.TEXTURE_2D, page.texture);
    // Unpack flags are ignored for ImageBitmaps; the bitmap's own premultiplication is uploaded.
    gl.texSubImage2D(gl.TEXTURE_2D, 0, place.x, place.y, gl.RGBA, gl.UNSIGNED_BYTE, image);
  }

  /** Upload a 1 px snapshot of 10% white and read it back: 255 is straight alpha, 26 premultiplied. */
  private straight(): boolean {
    if (this.straightSnapshots !== null) return this.straightSnapshots;
    const gl = this.gl;
    let straight = false;
    const canvas = new OffscreenCanvas(1, 1);
    const context = canvas.getContext("2d");
    if (context) {
      context.fillStyle = "rgba(255, 255, 255, 0.1)";
      context.fillRect(0, 0, 1, 1);
      const image = canvas.transferToImageBitmap();
      const texture = gl.createTexture();
      const framebuffer = gl.createFramebuffer();
      const previous = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      const pixel = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      straight = (pixel[0] ?? 0) > 128;
      gl.bindFramebuffer(gl.FRAMEBUFFER, previous);
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
      image.close();
    }
    this.straightSnapshots = straight;
    return straight;
  }

  /** Upload `image` to a scratch texture and draw it, premultiplied, into its place on a page. */
  private premultiplied(target: WebGLTexture, place: Placement, image: ImageBitmap): void {
    const gl = this.gl;
    if (!this.premultiplier) {
      const program = compileProgram(gl, "premultiply", PREMULTIPLY_VERTEX, PREMULTIPLY_FRAGMENT);
      const scratch = gl.createTexture();
      const framebuffer = gl.createFramebuffer();
      if (!scratch || !framebuffer) return;
      this.premultiplier = {
        program,
        origin: gl.getUniformLocation(program, "uOrigin"),
        image: gl.getUniformLocation(program, "uImage"),
        scratch,
        framebuffer,
      };
    }
    const { program, origin, image: sampler, scratch, framebuffer } = this.premultiplier;
    const previousFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const previousProgram = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
    const previousArray = gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null;
    const viewport = gl.getParameter(gl.VIEWPORT) as Int32Array;
    const scissor = gl.isEnabled(gl.SCISSOR_TEST);
    const blend = gl.isEnabled(gl.BLEND);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, scratch);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    // No mipmaps: without this the texture is incomplete and reads as transparent.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
    gl.viewport(place.x, place.y, place.width, place.height);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(program);
    gl.bindVertexArray(null);
    gl.uniform1i(sampler, 0);
    gl.uniform2f(origin, place.x, place.y);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, previousFramebuffer);
    gl.useProgram(previousProgram);
    gl.bindVertexArray(previousArray);
    gl.viewport(viewport[0] ?? 0, viewport[1] ?? 0, viewport[2] ?? 0, viewport[3] ?? 0);
    if (scissor) gl.enable(gl.SCISSOR_TEST);
    if (blend) gl.enable(gl.BLEND);
  }
}

/** Find room in an existing shelf of similar height, or open a new shelf. */
function shelfFit(page: Page, width: number, height: number): [number, number] | null {
  let best: Shelf | null = null;
  for (const shelf of page.shelves) {
    // A shelf takes a bitmap up to its height, but not one much shorter: that would waste rows.
    if (
      shelf.height >= height &&
      shelf.height <= height * 1.5 + 4 &&
      shelf.x + width <= page.width
    ) {
      if (!best || shelf.height < best.height) best = shelf;
    }
  }
  if (best) {
    const spot: [number, number] = [best.x, best.y];
    best.x += width;
    return spot;
  }
  if (page.top + height > page.height || width > page.width) return null;
  const shelf: Shelf = { y: page.top, height, x: width };
  page.shelves.push(shelf);
  page.top += height;
  return [0, shelf.y];
}
