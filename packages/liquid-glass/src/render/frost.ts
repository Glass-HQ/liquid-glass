import { compileProgram, createTarget, deleteTarget, type GL, type Target, uniforms } from "./gl";
import { contains, EMPTY, expand, intersect, isEmpty, type Box } from "./rect";
import blurFragment from "./shaders/frost-blur.frag.glsl?raw";
import downFragment from "./shaders/frost-down.frag.glsl?raw";
import fullscreenVertex from "./shaders/fullscreen.vert.glsl?raw";

/**
 * Frost is a blurred copy of a backdrop, computed on a grid of small cells and only where
 * frosted glass reads it: average each 4 px cell (in a gamma that favours light or dark
 * detail), then a separable Gaussian of the frost's full sigma over the cells, read
 * bilinearly by the glass. The cells are a quarter of the sigma or less, so the Gaussian
 * spans several of them and no cell shows. It stays valid until its backdrop changes, so glass
 * gliding over a still page reuses it, and a margin around what was needed lets small moves
 * reuse it too.
 */

/** Extra CSS px frosted around what glass needs, so small moves don't recompute. */
const MARGIN = 64;
/** Largest cell, CSS px; the downsample reads up to 8 × 8 bilinear taps per cell. */
const MAX_CELL = 4;
/** Cells per sigma, at least: the Gaussian spans 2.5 cells per sigma at the largest cell. */
const CELLS_PER_SIGMA = 2.5;
/** Most taps to either side of the separable Gaussian (the shader's loop bound). */
const MAX_TAPS = 16;

/**
 * The cell size, CSS px, for a frost of `sigma`. A frost too wide for the Gaussian's taps at the
 * largest cell (a progressive blur's strongest) takes larger cells, so the taps still span 2.5
 * sigma to either side.
 */
export function frostCell(sigma: number): number {
  const cell = Math.min(MAX_CELL, Math.max(1, sigma / CELLS_PER_SIGMA));
  return Math.max(cell, (2.5 * sigma) / MAX_TAPS);
}

export interface FrostSource {
  readonly target: Target;
  /** Changes whenever the backdrop's content changes. */
  readonly signature: string;
  /** Where the backdrop is valid, CSS px. */
  readonly valid: Box;
}

export interface Frost {
  readonly texture: WebGLTexture;
  /** Multiply a screen CSS position by this to get the frost texture's uv. */
  readonly uvScale: readonly [number, number];
  readonly gamma: number;
  /** A progressive blur's lighter frosts, lightest first; this one is its strongest. */
  readonly lighter?: readonly Frost[];
}

interface Entry {
  readonly cell: number;
  readonly sigma: number;
  readonly taps: number;
  readonly gamma: number;
  readonly width: number;
  readonly height: number;
  readonly down: Target;
  readonly across: Target;
  readonly blurred: Target;
  signature: string;
  valid: Box;
  usedAt: number;
}

export class FrostCache {
  private readonly down: WebGLProgram;
  private readonly blur: WebGLProgram;
  private readonly uDown;
  private readonly uBlur;
  private readonly entries = new Map<string, Entry>();
  private frame = 0;

  constructor(private readonly gl: GL) {
    this.down = compileProgram(gl, "frost downsample", fullscreenVertex, downFragment);
    this.blur = compileProgram(gl, "frost blur", fullscreenVertex, blurFragment);
    this.uDown = uniforms(gl, this.down, [
      "uSource",
      "uSourceSize",
      "uCell",
      "uTaps",
      "uGamma",
    ] as const);
    this.uBlur = uniforms(gl, this.blur, ["uSource", "uAxis", "uSigma", "uTaps"] as const);
  }

  beginFrame(): void {
    this.frame += 1;
  }

  /**
   * Frost of `source` at `sigma` CSS px, valid at least over `need` (screen CSS px). `key`
   * names the source texture; entries are per source, sigma and gamma.
   */
  ensure(
    key: string,
    source: FrostSource,
    sigma: number,
    gamma: number,
    need: Box,
    viewport: { width: number; height: number },
  ): Frost {
    const gl = this.gl;
    const cell = frostCell(sigma);
    const width = Math.max(1, Math.ceil(viewport.width / cell));
    const height = Math.max(1, Math.ceil(viewport.height / cell));
    const id = `${key}|${sigma}|${gamma}`;
    let entry = this.entries.get(id);
    if (entry && (entry.width !== width || entry.height !== height)) {
      this.free(id, entry);
      entry = undefined;
    }
    if (!entry) {
      entry = {
        cell,
        sigma: sigma / cell,
        taps: Math.min(MAX_TAPS, Math.ceil((2.5 * sigma) / cell)),
        gamma,
        width,
        height,
        down: createTarget(gl, width, height),
        across: createTarget(gl, width, height),
        blurred: createTarget(gl, width, height),
        signature: "",
        valid: EMPTY,
        usedAt: this.frame,
      };
      this.entries.set(id, entry);
    }
    entry.usedAt = this.frame;
    if (entry.signature !== source.signature) entry.valid = EMPTY;
    if (!contains(entry.valid, need)) this.compute(entry, source, need, viewport);
    entry.signature = source.signature;
    return {
      texture: entry.blurred.texture,
      uvScale: [1 / (entry.cell * entry.width), 1 / (entry.cell * entry.height)],
      gamma: entry.gamma,
    };
  }

  /** Drop entries no frame has used for a while (their glass went away). */
  sweep(): void {
    for (const [id, entry] of this.entries)
      if (this.frame - entry.usedAt > 120) this.free(id, entry);
  }

  dispose(): void {
    for (const [id, entry] of this.entries) this.free(id, entry);
    this.gl.deleteProgram(this.down);
    this.gl.deleteProgram(this.blur);
  }

  private compute(
    entry: Entry,
    source: FrostSource,
    need: Box,
    viewport: { width: number; height: number },
  ): void {
    const gl = this.gl;
    const region = intersect(
      expand(need, MARGIN),
      intersect(source.valid, [0, 0, viewport.width, viewport.height]),
    );
    if (isEmpty(region)) return;
    const c = entry.cell;
    const cells: Box = [
      Math.floor(region[0] / c),
      Math.floor(region[1] / c),
      Math.ceil(region[2] / c),
      Math.ceil(region[3] / c),
    ];
    const all: Box = [0, 0, entry.width, entry.height];
    const t = entry.taps;
    // Each blur pass reads `taps` cells to either side, so earlier passes cover more.
    const downCells = intersect([cells[0] - t, cells[1] - t, cells[2] + t, cells[3] + t], all);
    const acrossCells = intersect([cells[0], cells[1] - t, cells[2], cells[3] + t], all);
    const blurCells = intersect(cells, all);

    gl.disable(gl.BLEND);
    gl.enable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, entry.width, entry.height);

    gl.useProgram(this.down);
    gl.bindFramebuffer(gl.FRAMEBUFFER, entry.down.framebuffer);
    scissor(gl, downCells);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, source.target.texture);
    gl.uniform1i(this.uDown.uSource, 0);
    gl.uniform2f(this.uDown.uSourceSize, source.target.width, source.target.height);
    const texelsPerCell = (c * source.target.width) / viewport.width;
    gl.uniform1f(this.uDown.uCell, texelsPerCell);
    // Enough bilinear samples to touch every source texel of a cell, at most 8 × 8.
    gl.uniform1i(this.uDown.uTaps, Math.min(8, Math.max(1, Math.ceil(texelsPerCell / 2))));
    gl.uniform1f(this.uDown.uGamma, entry.gamma);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.useProgram(this.blur);
    gl.uniform1f(this.uBlur.uSigma, Math.max(entry.sigma, 0.01));
    gl.uniform1i(this.uBlur.uTaps, entry.taps);
    gl.uniform1i(this.uBlur.uSource, 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, entry.across.framebuffer);
    scissor(gl, acrossCells);
    gl.bindTexture(gl.TEXTURE_2D, entry.down.texture);
    gl.uniform2i(this.uBlur.uAxis, 1, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, entry.blurred.framebuffer);
    scissor(gl, blurCells);
    gl.bindTexture(gl.TEXTURE_2D, entry.across.texture);
    gl.uniform2i(this.uBlur.uAxis, 0, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    entry.valid = [blurCells[0] * c, blurCells[1] * c, blurCells[2] * c, blurCells[3] * c];
  }

  private free(id: string, entry: Entry): void {
    deleteTarget(this.gl, entry.down);
    deleteTarget(this.gl, entry.across);
    deleteTarget(this.gl, entry.blurred);
    this.entries.delete(id);
  }
}

function scissor(gl: GL, box: Box): void {
  gl.scissor(box[0], box[1], Math.max(0, box[2] - box[0]), Math.max(0, box[3] - box[1]));
}
