/**
 * Everything the page and the render worker say to each other. The page owns the DOM: it
 * captures what is drawn into a display list, measures glass surfaces and drives motion. The
 * worker owns the GPU: it repaints the display list, frosts it and draws glass over it into each
 * surface's canvas. Nothing else crosses the boundary.
 *
 * Units: CSS pixels unless a name says otherwise. Colors are straight (not premultiplied) RGBA
 * in 0..1. All positions are in viewport coordinates of the scene root at the moment they were
 * captured or measured.
 */

export type Rgba = readonly [r: number, g: number, b: number, a: number];

/**
 * Corner radii, clockwise from the top left. Glass draws them as continuous corners (`Shape`'s
 * `smoothing`); display list items, which redraw CSS boxes, as circular ones.
 */
export type Radii = readonly [
  topLeft: number,
  topRight: number,
  bottomRight: number,
  bottomLeft: number,
];

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// ---------------------------------------------------------------------------------------------
// Display list
// ---------------------------------------------------------------------------------------------

/**
 * A scroll container whose content moves under glass without a recapture. Id 0 is the viewport
 * itself. Items record which scroller they scroll with; every frame says how far each scroller
 * has moved since capture, and the worker shifts its items (and clips) by that much.
 */
export interface Scroller {
  readonly id: number;
  /** The scroller this one scrolls with (0 for the viewport). */
  readonly parent: number;
}

/** A rectangle, optionally rounded, that clips the items referring to it. */
export interface Clip {
  readonly id: number;
  /** The clip this one is nested in (0 for none). */
  readonly parent: number;
  readonly scroller: number;
  readonly rect: Rect;
  readonly radii: Radii;
}

export interface BoxShadow {
  readonly x: number;
  readonly y: number;
  readonly blur: number;
  readonly spread: number;
  readonly color: Rgba;
}

interface ItemBase {
  /** Stable while the node it came from lives; a recapture replaces items by key. */
  readonly key: number;
  /**
   * The glass surface this item is drawn on (0 for the page). An item owned by a surface is
   * painted after that surface's glass, so glass above it refracts both.
   */
  readonly owner: number;
  /** Paint order within the whole page, ascending. */
  readonly order: number;
  readonly scroller: number;
  readonly clip: number;
  /** Product of every ancestor's opacity. */
  readonly opacity: number;
}

/** A filled, bordered, shadowed, rounded rectangle: every CSS box background. */
export interface BoxItem extends ItemBase {
  readonly kind: "box";
  readonly rect: Rect;
  readonly radii: Radii;
  readonly fill: Rgba;
  /** Border widths, clockwise from the top. All zero for none. */
  readonly border: readonly [top: number, right: number, bottom: number, left: number];
  readonly borderColor: Rgba;
  readonly shadows: readonly BoxShadow[];
}

/**
 * A bitmap placed on the page: a text run rasterised with its color, an image, an icon, a
 * gradient, a video or canvas frame. `bitmap` names an entry sent in `BitmapUpload`.
 */
export interface BitmapItem extends ItemBase {
  readonly kind: "bitmap";
  readonly rect: Rect;
  readonly radii: Radii;
  readonly bitmap: number;
  /** The part of the bitmap to draw, in bitmap pixels. */
  readonly source: Rect;
}

export type Item = BoxItem | BitmapItem;

export interface BitmapUpload {
  readonly id: number;
  readonly image: ImageBitmap;
  /** Taken from a 2D canvas: some engines upload these with straight alpha. */
  readonly snapshot: boolean;
}

/**
 * A change to the display list. The first capture sends everything with `reset`; after that
 * only what changed. Removing an item frees nothing by itself; bitmaps are freed with
 * `releaseBitmaps` once no item uses them.
 */
export interface DisplayListPatch {
  readonly reset: boolean;
  readonly scrollers: readonly Scroller[];
  readonly clips: readonly Clip[];
  readonly upsert: readonly Item[];
  readonly remove: readonly number[];
  readonly bitmaps: readonly BitmapUpload[];
  readonly releaseBitmaps: readonly number[];
  /** Color drawn where the page is transparent (an app over a see-through window). */
  readonly backdrop: Rgba;
}

// ---------------------------------------------------------------------------------------------
// Glass
// ---------------------------------------------------------------------------------------------

export type MaterialKind = "regular" | "clear";

/** The side a progressive blur is strongest at; it fades to nothing at the opposite side. */
export type BlurEdge = "top" | "right" | "bottom" | "left";

/**
 * A progressive blur: what is behind is blurred most at `side` of the surface and not at all at
 * the opposite side. Over an opaque page the blur is laid over it. Over a see-through one
 * (`replace`), only the content of the scroller beside it is drawn, as see-through as it is, and
 * the page hides that content under the blur with `progressiveBlurMask`, so the sharp content
 * never shows through the blurred copy.
 */
export interface ProgressiveEdge {
  readonly side: BlurEdge;
  readonly replace: boolean;
}
export type Appearance = "light" | "dark";

/**
 * How a surface's glass looks. The page resolves every option to numbers before sending, so the
 * worker never guesses. `core/material.ts` turns a kind, an appearance and a size into these.
 */
export interface Material {
  readonly kind: MaterialKind;
  readonly appearance: Appearance;
  /** Gaussian sigma of the frost, CSS px. 0 for sharp (clear) glass. */
  readonly frost: number;
  /** How deep the rim's bend runs, CSS px. */
  readonly bezel: number;
  /**
   * How far the very rim looks inward, as a share of the corner radius: a point on the edge
   * shows what is `pull × radius` further in, falling off as (1 − depth / bezel)^falloff.
   */
  readonly pull: number;
  readonly falloff: number;
  /** Red/blue split of the rim's bend, 0..1. */
  readonly dispersion: number;
  /**
   * How much of the sharp backdrop frosted glass lets through, mixed with its frost: `sharp` in
   * the middle, rising by `rimSharp` towards the rim where the bend is. Part sharp and part
   * blurred, the bend stays visible as the glass moves.
   */
  readonly sharp: number;
  readonly rimSharp: number;
  /**
   * The face's tone on luma: seen + lift + luma × (gain − curve × luma) − luma. Light glass
   * lifts its darks (milky); dark glass also pulls its brights down.
   */
  readonly lift: number;
  readonly gain: number;
  readonly curve: number;
  readonly saturation: number;
  /** The two specular rims of the bevel (top and bottom). */
  readonly shine: number;
  /** A soft sheen just inside the lit edges, screen-blended. */
  readonly sheen: number;
  /** The hairline just outside the edge: strength on the flanks, share kept at top and bottom. */
  readonly hairline: number;
  readonly hairlineCap: number;
  /** Optional color laid over the body, alpha is its strength. */
  readonly tint: Rgba | null;
  /**
   * A black layer between the backdrop and the glass, 0..1: how much of what is behind is
   * dimmed before the glass draws it. Clear glass over bright content needs it;
   * `core/adapt.ts` sets it from what the worker measures behind the surface.
   */
  readonly dim: number;
  readonly shadow: BoxShadow | null;
  /** A progressive blur instead of glass: frost only, with no rim, tone, light or shadow. */
  readonly edge?: ProgressiveEdge | null;
  /**
   * Specular glass: the axis its two moving highlights lie on, radians on screen (y down,
   * following the pointer or the device's tilt). Null: the fixed light from above.
   */
  readonly lightAngle?: number | null;
}

export type ShapeRole = "body" | "lens" | "pill" | "thumb";

/**
 * One rounded rectangle of glass inside a surface, in the surface's own (untransformed) CSS px.
 * Shapes of one surface melt into each other as they near (`merge` is the largest blend radius).
 */
export interface Shape {
  readonly role: ShapeRole;
  readonly rect: Rect;
  readonly radii: Radii;
  /**
   * How the corners curve: 0 for circular arcs, 1 for continuous corners, which
   * leave the edges gradually (a radius-r corner starts 1.3 r from the corner). A corner with no
   * room for that (a capsule's ends) is drawn rounder, down to a circle. Default: the surface's
   * `smoothing`, which defaults to 1; the scene fills it in before a frame is sent.
   */
  readonly smoothing?: number;
  /** 0..1: a lifted lens magnifies and casts a stronger shadow. */
  readonly lift: number;
  /** Center magnification, 1 for none. */
  readonly magnify: number;
  readonly alpha: number;
  readonly merge: number;
  readonly tint: Rgba | null;
  /** Extra brightness from a press, 0..1. */
  readonly light: number;
}

/** A glass surface for one frame. */
export interface SurfaceFrame {
  readonly id: number;
  /** Stacking rank, ascending: a higher rank sees every lower surface in its backdrop. */
  readonly rank: number;
  /** Where the surface's border box is on screen now (after CSS transforms). */
  readonly screen: Rect;
  /** The surface's border box size before transforms; shapes are in these units. */
  readonly size: { readonly width: number; readonly height: number };
  readonly shapes: readonly Shape[];
  readonly material: Material;
  readonly opacity: number;
  /**
   * How far the canvas reaches outside the border box on each side (top, right, bottom, left),
   * for shadows and shapes that overhang. A side can be trimmed so the canvas never makes the
   * page scroll further.
   */
  readonly bleed: readonly [top: number, right: number, bottom: number, left: number];
  /** Whether items owned by this surface are drawn by the worker on top of the glass. */
  readonly labelsInGlass: boolean;
  /**
   * For a replacing progressive blur: the scroller whose content it stands in for. It draws
   * what scrolls in there and nothing of what is behind (a pane's own background).
   */
  readonly replaces?: number;
}

// ---------------------------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------------------------

export interface FrameMessage {
  readonly type: "frame";
  readonly sequence: number;
  /** performance.now() on the page when the frame's inputs were read. */
  readonly time: number;
  readonly viewport: { readonly width: number; readonly height: number; readonly dpr: number };
  /** Flat [scrollerId, dx, dy, ...]: how far each scroller has moved since capture. */
  readonly scroll: Float32Array;
  readonly surfaces: readonly SurfaceFrame[];
}

export type PageMessage =
  | {
      readonly type: "start";
      /** True on iOS and iPadOS: present frames without waiting for the page's rendering update. */
      readonly desynchronized: boolean;
      readonly telemetry: boolean;
    }
  | { readonly type: "attach"; readonly surface: number; readonly canvas: OffscreenCanvas }
  | { readonly type: "detach"; readonly surface: number }
  | { readonly type: "display"; readonly patch: DisplayListPatch }
  | FrameMessage
  | { readonly type: "dispose" };

/**
 * What is behind a surface, measured by the worker on the backdrop it reads, over the body's
 * box. All 0..1, on luma (Rec. 709 weights of the sRGB-encoded color). Sent when a surface is
 * redrawn and its reading moved; the page decides what to do with it (core/adapt.ts).
 */
export interface BackdropReading {
  readonly id: number;
  /** Mean luma. */
  readonly luma: number;
  /** Twice the standard deviation of luma: 0 over a flat color, near 1 over black text on white. */
  readonly contrast: number;
  /** Share of the area brighter than 0.6 luma. */
  readonly bright: number;
  /**
   * Fine detail: the mean luma step between points 1.5 px apart, doubled. Near 0 over flat
   * color and soft photos, higher over running text.
   */
  readonly detail: number;
}

export type WorkerMessage =
  | { readonly type: "ready" }
  | { readonly type: "backdrop"; readonly readings: readonly BackdropReading[] }
  | { readonly type: "presented"; readonly sequence: number; readonly at: number }
  | { readonly type: "telemetry"; readonly counters: TelemetryCounters }
  | { readonly type: "error"; readonly message: string };

/** Counts and summed milliseconds since the last report, keyed by counter name. */
export type TelemetryCounters = Readonly<
  Record<string, { readonly count: number; readonly ms: number }>
>;
