# @glass-sdk/liquid-glass

Liquid Glass for the web: refraction, frost, rim light and springy motion, drawn by one WebGL2
renderer in a worker. The same pixels in Chromium, Electron, WebKit and Gecko, and frames
at the display's rate, including 120 Hz in iOS Safari.

The browser never composites the glass: no `backdrop-filter`, no SVG filters. The page captures
its own DOM into a display list, the worker repaints it on the GPU and draws every glass surface
over it. Everything a person reads or clicks stays real DOM; the glass is a canvas behind it.

## Install

```sh
npm install @glass-sdk/liquid-glass
# or: bun add / pnpm add / yarn add
```

React 19 is an optional peer dependency (only for `@glass-sdk/liquid-glass/react`). No bundler
setup is needed: the worker ships inlined.

Importing the React entry costs about 10 KB gzip. The engine (scene and motion, then the capture
and the renderer with its worker) loads on demand when a scene is created, about 70 KB gzip in
three chunks.

## Quick start

### React

```tsx
import { GlassButton, GlassScene, GlassSurface } from "@glass-sdk/liquid-glass/react";

export function App() {
  return (
    <GlassScene appearance="auto" material="regular">
      <main>…your page…</main>
      <GlassSurface className="toolbar" radius="capsule" floating>
        <GlassButton onClick={save}>Save</GlassButton>
      </GlassSurface>
    </GlassScene>
  );
}
```

`<GlassScene>` is the root of the app: its children are both the content that glass refracts and
the glass itself. Glass refracts what is inside the scene's root element, so put it high in the
tree. `useGlassScene()` returns the scene once its engine has loaded (null before).

### Vanilla

```ts
import { createGlassScene } from "@glass-sdk/liquid-glass";

const scene = createGlassScene({ root: document.body, appearance: "auto" });
const surface = scene.addSurface(document.querySelector(".toolbar")!, {
  radius: "capsule",
  material: "regular",
  floating: true,
});

// Later:
surface.remove();
scene.destroy();
```

`createGlassScene` returns at once; surfaces, shapes, sources and motion added before the engine
has loaded are kept and drawn when it arrives.

## Components

| Component                                                                                                                                                                            | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GlassScene`                                                                                                                                                                         | The root. Props: `material` (`"regular"`, `"clear"`), `appearance` (`"light"`, `"dark"`, `"auto"`), `tintAmount` (`"clear"`, `"default"`, `"tinted"` or 0..1, see Materials), `backdrop` (CSS color shown where the page is transparent), `adaptive` (default true, see Readability), `specular` (default false), `telemetry`.                                                                                                                                                                                                                                |
| `GlassSurface`                                                                                                                                                                       | Glass behind its children. `as` or `render` makes any element glass. Props: `material`, `appearance`, `tint`, `radius` (`"capsule"`, a number or four), `smoothing` (see Corners), `floating` (menus, popovers, dialogs: panel look, deeper shadow), `labelsInGlass`, `bleed`, `adaptive`, `specular`.                                                                                                                                                                                                                                                        |
| `GlassButton`                                                                                                                                                                        | A real `<button>` that is glass: it grows, lights up under the pointer and springs back.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `GlassHighlight`                                                                                                                                                                     | Inside a surface: a pill that follows a target element (the hovered row), concentric with the surface's corners near them.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `GlassToolbar`, `GlassToolbarButton`, `GlassToolbarSeparator`, `GlassToolbarSpacer`                                                                                                  | A row of tools on one piece of glass, with a pill under the tool being pointed at. A spacer (`sizing="fixed"` or `"flexible"`) splits the bar into separate pieces of glass. Arrow keys, Home and End move between tools.                                                                                                                                                                                                                                                                                                                                     |
| `GlassTabBar`, `GlassTab`                                                                                                                                                            | A floating tab bar of tabs (`icon` over `label`), whose selection lifts into a lens that follows a drag and stretches the bar at its ends.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `GlassSegmented`, `GlassSegmentedItem`                                                                                                                                               | Tabs or a choice: the selected segment sits on a pill concentric with the bar; pressing lifts a lens a third of its height past each end, which follows the pointer 1:1. Keyboard: arrows, Home, End.                                                                                                                                                                                                                                                                                                                                                         |
| `GlassMenu`, `GlassMenuTrigger`, `GlassMenuPopup`, `GlassMenuItem`, `GlassMenuSeparator`, `GlassMenuHeading`, `GlassMenuSubmenu`, `GlassMenuSubmenuTrigger`, `GlassMenuSubmenuPopup` | A menu whose button morphs into its panel and back, with submenus beside their rows. The panel renders over the whole page (the scene's root, or `container`), so nothing the button sits in clips it; it moves to the other side and along when the window has no room, and scrolls when taller than the room it has. Items can be choices (`role="menuitemradio"` or `"menuitemcheckbox"` with `checked`), links (`render`), the current page (`current`) or tinted (`tint`). Keyboard: arrows, Home, End, Enter, Escape, and typing a row's first letters. |
| `GlassContextMenu`, `GlassContextMenuTrigger`                                                                                                                                        | The same menu for a region: right-clicking, long-pressing or the menu key opens it at the pointer, growing out of that point. `ignore` leaves right-clicks on matching descendants (links, fields) to them.                                                                                                                                                                                                                                                                                                                                                   |
| `GlassSwitch`                                                                                                                                                                        | A switch whose thumb lifts into a lens while held. `tint` colors the track while on.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `GlassSlider`                                                                                                                                                                        | A slider whose thumb lifts into a lens while dragged, continuous or in `step`s with `ticks`. `tint` colors the fill.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `GlassColorPicker`                                                                                                                                                                   | A hue and saturation wheel whose knob lifts into a clear lens while dragged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `GlassGroup`                                                                                                                                                                         | Draws the glass inside it as one piece, so neighbours melt into each other when they come within `spacing` (default 7.33 px), like a pressed button growing into the bar beside it.                                                                                                                                                                                                                                                                                                                                                                           |
| `GlassProgressiveBlur`                                                                                                                                                               | A blur that deepens towards one `edge` and is gone a little way in, for content scrolling under a bar: the browser's backdrop blur in five layers, so it needs an opaque surface behind it. `GlassProgressiveBlurFilter` is the same blur as an SVG filter for the element to blur itself (`filter: url(#id)`), for see-through surfaces.                                                                                                                                                                                                                     |

Hooks: `useGlassScene`, `useGlassSurface` (make your own element glass), `useGlassSurfaceContext`,
`useGlassTone` (the resolved tone of the enclosing surface), `useGlassTelemetry`.

Glass components take `material`, `tint`, `appearance` and `specular`. A `tint` is any CSS color,
including `var(--accent)`: variables are resolved on the surface element every frame, so tints
follow theme changes.

### Styling

The library injects one small stylesheet. Its component defaults live in
`@layer liquid-glass`, declared first, so any app style wins, layered or not. Sizes and colors
are custom properties:

| Property                                                                                   | Default                                      |
| ------------------------------------------------------------------------------------------ | -------------------------------------------- |
| `--lg-button-height`, `--lg-button-padding`, `--lg-button-gap`, `--lg-button-radius`       | 28px, 10px, 4px, 999px                       |
| `--lg-toolbar-padding`, `--lg-toolbar-gap`, `--lg-toolbar-item-size`, `--lg-toolbar-space` | 3px, 4px, 22px, 8px                          |
| `--lg-segmented-padding`, `--lg-segmented-radius`                                          | 3px, 999px                                   |
| `--lg-segment-height`, `--lg-segment-padding`, `--lg-segment-gap`                          | 26px, 10px, 6px                              |
| `--lg-tab-width`, `--lg-tab-icon-size`                                                     | 100px, 26px                                  |
| `--lg-menu-width`, `--lg-menu-padding`, `--lg-menu-row`                                    | 128px, 4px, 28px                             |
| `--lg-switch-width`, `--lg-switch-height`                                                  | 54px, 24px                                   |
| `--lg-switch-on`, `--lg-switch-off`                                                        | #8e8e93, rgb(120 120 128 / .32)              |
| `--lg-slider-height`, `--lg-slider-thumb-width`, `--lg-slider-thumb-height`                | 28px, 20px, 16px                             |
| `--lg-slider-fill`                                                                         | #8e8e93                                      |
| `--lg-disabled-opacity`, `--lg-focus-ring`                                                 | .45, 2px solid Highlight                     |
| `--lg-label-light`, `--lg-label-dark`                                                      | #000, #fff: text on glass whose tone flipped |

Give glass elements a transparent background: the glass is drawn behind the element's content,
above its own background.

## Corners

Glass draws every corner as a continuous corner, not a circular arc: a squircle that keeps a
circular arc around its middle and eases into each edge, reaching about 1.8 r along it.
`smoothing` on a surface (or on a `Shape`) goes from 0 (circular arcs) to 1 (continuous, the
default). A side too short for its full curve gives up smoothing on that side only, so a
capsule's ends stay half circles while its long sides still ease in.

Shapes nested in glass are concentric with it, the same curve moved inward:

- `GlassHighlight`: each corner of the pill near a corner of its surface takes the surface's
  radius less the pill's distance from that corner; elsewhere it keeps `radius` (by default the
  target's own `border-radius`). The first row of a menu follows the menu's corners, the rows
  between keep their own, and the pill rounds into a corner as it slides there.
- `GlassSegmented`: the pill is the bar's radius less its inset (`segmentRadius` overrides it).
- `concentricRadii(inner, containerSize, containerRadii, own)` gives the same corners for your
  own shapes.

The library leaves your CSS alone. Elements drawn by CSS keep circular `border-radius`
corners, and so do their copies under the glass. Where both are small radii the two curves differ
by under half a pixel. Where you need an exact match, draw the element as glass (a
`GlassHighlight` instead of a CSS hover background). CSS `corner-shape: squircle` would do it in
Chrome and Safari, but Firefox doesn't ship it yet.

## Materials

- **Regular** frosts what is behind it (a σ 10 px Gaussian) and tones it toward the appearance
  with a milky lift, so text on it stays legible over anything: in light, black behind shows as
  151 of 255 and white as 253; in dark, black as 40 and white as 170.
- **Clear** keeps the backdrop sharp and untoned: only the rim bends it and catches the light. It
  is meant for glass over media, with bold, bright content on it. Floating clear panels (menus,
  popovers, palettes) frost lightly, since they carry text.

Both share the rim: within 15 px of the edge, what is behind is pulled inward by up to a third of
the corner radius, falling off with the 2.5th power of the depth, red and blue split by 22% of
it on clear glass. Light comes from straight above: two thin specular rims on a 1.2 px bevel, a
sheen just inside the top and bottom, a faint shade along the flanks, and a hairline just outside
the edge.

With `specular` (on the scene, or on any surface or control), these same highlights turn toward
the pointer, or with the device's tilt where the browser reports it without asking, instead of
staying above. Nothing else is added, so they stay just as subtle. Off by default.

### Clear or tinted regular glass (`tintAmount`)

The scene's `tintAmount` changes regular glass everywhere: toward "clear" more of what is behind
shows through, sharper and less toned (σ 6 px of frost at 0); toward "tinted" it frosts more
(σ 14 px at 1), light glass gets milkier and dark glass darker. The clear material doesn't change
with it, and readability adapting (below) works the same at any amount.

```tsx
<GlassScene tintAmount="clear">…</GlassScene>; // or "default" (0.5), "tinted", 0..1
createGlassScene({ tintAmount: 0.25 }); // scene.configure({ tintAmount }) changes it live
```

## Readability: glass adapts to what is behind it

The worker measures what is behind every surface it draws (mean luma, contrast, the bright
share and fine detail, on the GPU) and the page adapts the glass:

- **Small regular glass flips.** Controls, toolbars and tab bars (88 px or less on the shorter
  side, not floating, not tinted, no pinned `appearance`) turn into dark glass over dark content
  and light glass over light content, with hysteresis: in light mode dark below a
  mean luma of 0.1 and light again above 0.3, in dark mode light above 0.9 and dark again below
  0.7. The flip cross-fades over 0.3 s. Larger glass (panels, menus, sidebars) never flips, and
  glass inside glass follows the glass it sits on.
- **Regular glass deepens its shadow over text** (up to 2.5×) and lightens it over a flat light
  background (to half).
- **Clear glass dims bright content.** A black layer under the glass at up to 35%, plus up to 25% more over busy content with bright strokes, and a σ 3 px
  frost over dense text. Over flat, light content it takes dark labels and no dimming.
- **Labels follow.** Each surface carries `data-lg-tone="light|dark"`: the tone its labels
  should take ("dark" glass wants light labels). When the tone differs from the app's
  appearance, the surface's own text color switches to `--lg-label-light` (default `#000`) or
  `--lg-label-dark` (default `#fff`); elements with a color of their own keep it. Read it in
  script with `surface.tone` / `surface.onTone(listener)`, or `useGlassTone()` in React.

Turn it off with `adaptive: false` on the scene or a surface (`<GlassScene adaptive={false}>`).

```tsx
function ToolbarIcon() {
  const tone = useGlassTone(); // the enclosing surface's tone, null outside one
  return <Icon color={tone === "light" ? "black" : "white"} />;
}
```

```css
/* Or in CSS: */
.toolbar[data-lg-tone="light"] .badge {
  background: rgb(0 0 0 / 0.08);
}
```

## What can be under glass

Glass refracts what the capture can redraw:

- Supported: background colors and gradients, borders, border radii, outer box shadows, text in
  any script (each line run is rasterised by the browser, so shaping, ligatures and emoji are the
  browser's own), images (same origin or CORS-enabled), inline SVG, `<input>` and `<textarea>`
  values, opacity, overflow clips, nested scrollers (scrolling needs no recapture), other glass
  surfaces and their content.
- Fed live: `<canvas>` and `<video>` elements, with `scene.addSource(element)` (or
  `useGlassScene()?.addSource(element)` in an effect). It returns a stop function.
- Not supported: iframes and cross-origin images without CORS (transparent under glass, so the
  scene's `backdrop` color shows there); CSS filters, blend modes, masks, inset shadows and
  `backdrop-filter` on content (the content is drawn without the effect); 3D perspective.

Changes under glass are picked up by MutationObserver, ResizeObserver, font and image loads.
Script-driven changes the scene can't see (a canvas you draw into without `addSource`) need
`scene.invalidate(element)`.

## Layout notes

- A surface gets `isolation: isolate`, and `position: relative` if it was static.
- Its canvas is normally its first child. A surface that clips or scrolls its content (`overflow`
  other than `visible`: a menu with a scrolling list) gets its canvas as the previous sibling
  instead, so shadows aren't clipped and the canvas doesn't scroll or add to the scroll range.
  Its transform and opacity are copied to the canvas each frame.
- Canvases never widen the page: near the right edge their overhang is trimmed.
- Canvases are `aria-hidden`, `pointer-events: none` and carry `data-lg-canvas`; selectors like
  `:first-child` inside a surface see them.

## Telemetry

```ts
const scene = createGlassScene({ telemetry: true });
scene.telemetry.subscribe((report) => {
  // report.counters: { name: { count, ms } } since the last report (report.intervalMs)
});
```

In React: `<GlassScene telemetry>` and `useGlassTelemetry()`. Counters: `page.frame` (frames
posted), `page.measure`, `page.capture`, `page.capture.items`, `page.gap` (gaps of 20 ms or more
while moving), `input.sample`, `input.unique`, and the worker's `worker.present`,
`worker.underlay`, `worker.frost`, `worker.glass`, `worker.copy`, `worker.commit` (time the
browser spends presenting placeholders after a frame), `worker.partial` and `worker.kpx`
(placeholders redrawn only in part, and thousands of pixels redrawn: counts). Boot marks
(`liquid-glass:scene`, `liquid-glass:engine`) are `performance.mark`s.

## Browser support

Chrome and Edge 111+, Safari 17+ (macOS, iOS, iPadOS), Firefox 117+, and Electron with a
Chromium of the same age. It needs WebGL2 in workers, `OffscreenCanvas` and
`transferControlToOffscreen()`. Where those are missing, or the GPU context fails, surfaces fall
back to a translucent CSS background (`data-lg-fallback`) and `scene.error` says why.

Every engine runs the same code. The only engine-specific paths are for 120 Hz on iOS:

- **Frame loop.** iOS Safari holds `requestAnimationFrame` to 60 Hz while the display runs at
  120, but worker canvases can present at 120 when created with `desynchronized` (only enabled
  there). Where `GestureEvent` exists, the loop runs on a MessageChannel + `setTimeout` grid
  phase-locked to an empty rAF loop, two samples per 120 Hz frame.
- **Boost.** A hidden 8 px scroller smooth-scrolls while something moves, which keeps ProMotion at
  120 Hz.
- **Input.** Touch drags on the tab bar, switch and slider go through invisible, endless native
  scrollers laid over them ("controllers"), whose positions are read every tick: that is how
  touch input reaches 120 Hz there. Mouse and pen use pointer events as everywhere else.

Electron: use it like Chrome. For a window with a transparent background, pass `backdrop` (the
color the glass should assume where the page is transparent).

## Reduced motion

With `prefers-reduced-motion: reduce`, presses, lenses and thumbs move without springs and
stretch.
