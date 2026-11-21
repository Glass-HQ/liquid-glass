# Liquid Glass

Glass surfaces and controls for React, the web, and Electron. Clear and Regular materials support light and dark appearances and refract live content.

[Examples and component reference](https://liquid-glass.glassapp.dev/#examples) · [GitHub](https://github.com/Glass-HQ/liquid-glass)

## Install

```sh
npm install @glass-sdk/liquid-glass @base-ui/react
```

## Quick start

```tsx
import { GlassScene, GlassContent, GlassSurface, GlassButton } from "@glass-sdk/liquid-glass";
import "@glass-sdk/liquid-glass/styles.css";

export function Example() {
  return (
    <GlassScene material="regular" appearance="light" style={{ height: 320 }}>
      <GlassContent>
        <img
          src="/landscape.jpg"
          alt="Mountain lake"
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </GlassContent>
      <GlassSurface radius={28} style={{ position: "absolute", left: 24, top: 100, padding: 20 }}>
        <GlassButton onClick={() => console.log("Saved")}>Save</GlassButton>
      </GlassSurface>
    </GlassScene>
  );
}
```

Import the stylesheet once. It requires neither Tailwind nor a CSS reset. Put glass components inside `GlassScene`, with one `GlassContent` layer for the background. Text, SVG, and images in that layer stay live. In Next.js, use a client component.

`GlassContent` keeps your props, ref, and children on its source element inside stable transparent wrappers. Target its class rather than relying on it being a direct child of the scene. Put opacity and clipping intended for the finished composition on `GlassScene` or a shared ancestor; `GlassContent` styles describe the input behind the glass.

## Components

| Component                                                                                           | Purpose                                                    |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `GlassScene`, `GlassContent`                                                                        | Scene and live background layer.                           |
| `GlassSurface`, `GlassButton`                                                                       | Glass container and button.                                |
| `GlassToolbar`, `GlassToolbarButton`, `GlassToolbarLink`, `GlassToolbarGroup`, `GlassToolbarSpacer` | Keyboard-navigable toolbar.                                |
| `GlassTabs`                                                                                         | Tab bar with a moving selection indicator.                 |
| `GlassTabsRoot`, `GlassTabsList`, `GlassTabsTrigger`, `GlassTabsIndicator`, `GlassTabsContent`      | Composable tabs and panels.                                |
| `GlassMenu`, `GlassMenuTrigger`, `GlassMenuContent`, `GlassMenuItem`                                | Menu with positioning and focus restoration.               |
| `GlassMenuSubmenu`, `GlassMenuSubmenuTrigger`, `GlassMenuSubmenuContent`                            | Nested menus.                                              |
| `GlassSlider`, `GlassSwitch`                                                                        | Slider and switch.                                         |
| `GlassColorPicker`                                                                                  | Color wheel with a glass bubble that picks colors.         |
| `GlassForeground`, `useGlassForeground`                                                             | Foreground content that higher glass surfaces can refract. |
| `GlassShape`, `GlassShapeContainer`, `GlassCorner`                                                  | Continuous corners and container-relative geometry.        |
| `GlassProgressiveBlur`, `GlassScrollEdges`                                                          | Progressive blur over background content and scroll edges. |

Buttons, toolbars, tabs, menus, sliders, and switches use Base UI behavior. Standard props, refs, accessible names, and state callbacks remain available. See the [component examples](https://liquid-glass.glassapp.dev/#examples) for usage and the [Base UI reference](https://base-ui.com/react/overview/quick-start) for inherited props.

## Material and motion

Set defaults on `GlassScene`; individual surfaces can override them.

The materials follow macOS's own glass in an active window, taken from the filter values Core Animation gives `NSGlassEffectView` on macOS 27 and checked against captures in both appearances. Like macOS's, glass changes with its size: every value follows the shorter side of the shape. Glass up to 64px, such as buttons and capsules, stays nearly clear and bends its rim by half its height; from there to 160px it gathers frost, a darker face in dark appearance and a soft shadow, as panels and menus have. **Clear** keeps what is behind it sharp, lifts it a little, and bends it hard at the rim. **Regular** reads what is behind it nearly sharp and blends in a softer copy, keeping the darker of the two in dark appearance and the lighter in light, then compresses bright backdrops in dark appearance and lifts dark ones in light. The rim is lit as on macOS: a key light from above and a fill light from below add to the glass along its top and bottom edges, strongest on the outermost half pixel and fading over a few pixels and about 45 degrees around the shape, and a fine outline darkens what is behind the glass by its outermost pixel, most where the edge faces sideways. Regular glass also shades its face faintly along a ring a few pixels in. **Lens** is a clear magnifier with colored fringes where it bends, as a control's thumb lifts into under a press: it passes the pixels under it unchanged. `frost` moves Regular and Clear toward opaque, like the Liquid Glass slider in macOS's Appearance settings. Glass that floats above the window, a menu or popover, casts a deeper shadow; set `floating` on any other surface that does. macOS draws its menus Regular: Clear glass keeps what is behind it sharp, so a Clear menu over text or other glass is hard to read.

| Prop          | Default            | Usage                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `material`    | `"regular"`        | `"regular"`, `"clear"` or `"lens"`.                                                                                                                                                                                                                                                                                                                                                       |
| `appearance`  | `"light"`          | `"light"` or `"dark"`.                                                                                                                                                                                                                                                                                                                                                                    |
| `radius`      | Component-specific | Continuous corner radius in CSS pixels, `"capsule"`, or `"circle"`. Generic surfaces default to 8px.                                                                                                                                                                                                                                                                                      |
| `refraction`  | By size            | Nonnegative displacement in CSS pixels. By default half the shorter side, up to 60 (Clear: 0.65 of it; Lens: a quarter). Nested surfaces limit their default to the parent inset.                                                                                                                                                                                                         |
| `tint`        | None               | Six-digit hex color. Colors the glass without changing text or icons.                                                                                                                                                                                                                                                                                                                     |
| `interactive` | Component-specific | Press feedback as on macOS: the glass grows 2.5px wider under a press, keeping its proportions, a soft light gathers under the pointer, and it settles back on release; a drag neither moves nor stretches it. On by default for buttons, toolbars, and tab bars. While pressed, links and images inside stop starting a native browser drag; mark content `draggable="true"` to keep it. |
| `specular`    | `false`            | Two equal rim highlights on opposite corners that turn toward the pointer, and with the device's tilt on Android. Reduced motion holds them at the top left and bottom right.                                                                                                                                                                                                             |
| `frost`       | `0`                | From 0 (most see-through) to 1 (most frosted): more blur, and Regular darkens (dark appearance) or lightens (light) toward opaque. Clear changes only past 0.5, as on macOS. Lens ignores it.                                                                                                                                                                                             |
| `motion`      | `"full"`           | `"full"`, `"reduced"`, or `"none"`; inherited from the scene.                                                                                                                                                                                                                                                                                                                             |

Pressed thumbs lift into Lens glass as macOS's do: a switch's grows to about 1.55 times its size and a slider's to 1.25, over 210ms, and while dragged the lens stretches up to 2.5% along its path and wobbles once when it stops. Their `tint` sets the track color; without one, the `--lg-accent` custom property does, so a stylesheet or a theme variable can color them (`--lg-accent: var(--accent)`).

Glass takes its look from what is behind it, so over transparent content, such as a control in a small scene of its own, Regular and Clear glass would show only their rims. Set `--lg-backdrop` to the color behind the scene, and glass treats that color as its backdrop wherever the content is transparent: its frost, tone, and refraction look as they would over content of that color. Set it on the scene or any ancestor, with a stylesheet or a theme variable:

```css
.toolbar {
  --lg-backdrop: var(--window-background);
}
```

The color paints only through the glass; the content and the space around the glass stay transparent. A new color applies without rebuilding the filter. Unset or transparent, it changes nothing.

System reduced-motion preferences always apply, including with `motion="full"`. Reduced motion removes stretching and travel; `"none"` removes transitions. Safari uses the same motion settings as other browsers.

Override styles with `className`, inline styles, or CSS utilities. The stylesheet uses low-specificity `:where()` selectors. Use `radius` to change corners so the material and content clip agree. Override `--lg-foreground` for text and icon colors.

## Composing controls

The `render` prop merges props, handlers, styles, and refs with your component. Custom components must forward them to their DOM element. Use transparent backgrounds to keep the glass visible.

```tsx
<GlassSurface material="clear" render={<Button onClick={save} />}>
  Save
</GlassSurface>
```

Menus open and close without animation. Menus stay inside their scene. Content accepts `side`, `align`, `sideOffset`, `alignOffset`, and `collisionAvoidance`; defaults are bottom/end with an 8px offset. Use `positionerProps` and `portalProps` for additional Base UI options.

```tsx
<GlassMenu>
  <GlassMenuTrigger render={<GlassButton />}>Options</GlassMenuTrigger>
  <GlassMenuContent>
    <GlassMenuItem onClick={save}>Save</GlassMenuItem>
    <GlassMenuSubmenu>
      <GlassMenuSubmenuTrigger>Share</GlassMenuSubmenuTrigger>
      <GlassMenuSubmenuContent>
        <GlassMenuItem onClick={copyLink}>Copy link</GlassMenuItem>
      </GlassMenuSubmenuContent>
    </GlassMenuSubmenu>
  </GlassMenuContent>
</GlassMenu>
```

`GlassMenuGroup`, `GlassMenuGroupLabel`, `GlassMenuSeparator`, `GlassMenuCheckboxItem`, `GlassMenuRadioGroup`, and `GlassMenuRadioItem` expose the corresponding Base UI parts.

In a toolbar, compose the trigger with `GlassToolbarButton render={<GlassMenuTrigger />}`. Use toolbar buttons and links for arrow-key navigation. `GlassToolbarSpacer` separates glass groups: `sizing="fixed"` gives an 8px gap; `"flexible"` fills available space. Give the toolbar a width or height for flexible spacing.

## Tabs, sliders, and switches

```tsx
<GlassTabs aria-label="Navigation" defaultValue="home"
  items={[{ value: "home", label: "Home" }, { value: "library", label: "Library" }]} />

<GlassSlider aria-label="Volume" defaultValue={50}
  onValueCommitted={(value) => console.log(value)} />
<GlassSlider ticks aria-label="Intensity" min={0} max={100} step={25} />
<label>Notifications <GlassSwitch name="notifications" defaultChecked /></label>
```

Tabs select the first enabled item unless `defaultValue` is set. Use `value` and `onValueChange` for controlled selection. For panels or custom triggers, compose the tab parts:

```tsx
<GlassTabsRoot defaultValue="preview">
  <GlassTabsList aria-label="View">
    <GlassTabsIndicator />
    <GlassTabsTrigger value="preview">Preview</GlassTabsTrigger>
    <GlassTabsTrigger value="usage">Usage</GlassTabsTrigger>
  </GlassTabsList>
  <GlassTabsContent value="preview">Your preview</GlassTabsContent>
  <GlassTabsContent value="usage">Your usage code</GlassTabsContent>
</GlassTabsRoot>
```

The list also works within an existing Base UI tabs root; do not nest another root. Keep interactive elements out of tab labels.

The selection moves as macOS 27's tabs do. At rest the chosen tab sits on a small plate of glass (`GlassTabsIndicator`, Regular by default; `--lg-tab-selection` sets its fill). A press lifts a Lens out of it, a third of the tab's height wider at each end and taller above and below, which magnifies the labels under it while the plate fades. Pressing another tab carries the lens there as it lifts. Dragging moves the lens with the pointer at the size it lifted at, squashing with speed and wobbling as it stops; only at either end of the bar does it take on that tab's size. Letting go settles it onto the tab under its centre, at that tab's size. The lens is a glass surface only while it shows: it is added to the scene's root, beside the bar, so the bar's shape never clips it. The bar itself holds still under a press; set `interactive` on `GlassTabsList` to have it grow.

Sliders accept a numeric `value` or `defaultValue`, `min`, `max`, `step`, `onValueChange`, and `onValueCommitted`. Defaults are 0–100 with a 0.1 step. With `ticks`, the step must divide the range evenly, with at most 100 intervals. `thumbProps` exposes input refs and accessible value text. `disabled` dims the slider and stops pointer and keyboard changes.

Switches accept Base UI switch props, including `checked`, `defaultChecked`, `onCheckedChange`, `name`, `inputRef`, `readOnly`, and `disabled`. A disabled switch is dimmed, ignores pointer, drag and keyboard input, leaves the tab order, and is announced as disabled.

A switch is 54 × 24 pixels by default. To resize it, set only its own `width` and `height` (with a class, inline style, or atomic CSS): the thumb fills the height inside the 2px padding at a 32:20 ratio and travels the width that remains, in either text direction. A macOS-sized switch is `width: 44px; height: 20px`, with a 25.6 × 16 thumb. Name inputs with a label or `aria-label`. Both controls support forms, RTL, `tint`, and reduced motion.

## Color picker

`GlassColorPicker` is a hue and saturation wheel. A small dot of the chosen color marks it exactly, and pressing the wheel grows the dot into a Lens glass bubble that follows the pointer, with a point at its center on the exact color. It renders its own scene, so it does not need a `GlassScene` around it.

```tsx
const [color, setColor] = useState("#0a84ff");

<GlassColorPicker value={color} onValueChange={setColor} name="color" />;
```

Values are six-digit hex colors, picked at full brightness. `onValueCommitted` fires when a drag or key press ends. Arrow keys change hue (left and right) and saturation (up and down); Shift takes larger steps. `size` sets the wheel diameter (default 240). The lens is always Lens glass, with no frost, so the color under it shows as it is; it defaults to `refraction={16}` and `specular`. Set [`--lg-backdrop`](#material-and-motion) to the color behind the picker: the lens refracts it at the wheel's edge.

## Progressive blur

`GlassProgressiveBlur` softens `GlassContent` at an edge. Put captions and controls outside that content layer to keep them sharp.

```tsx
<GlassScene style={{ height: 320, overflow: "hidden" }}>
  <GlassContent>
    <img
      src="/landscape.jpg"
      alt="Mountain lake"
      style={{ width: "100%", height: "100%", objectFit: "cover" }}
    />
  </GlassContent>
  <GlassProgressiveBlur edge="bottom" size={80} blur={20} />
</GlassScene>
```

For scrolling content, use `GlassContent layout="scroll"` as the viewport and pass its ref to `GlassScrollEdges`. This keeps the glass and blur stationary during Safari scrolling. Give the scene a bounded height, and place floating controls beside the content:

```tsx
const viewport = useRef<HTMLDivElement>(null);

<GlassScene style={{ height: 320, overflow: "hidden" }}>
  <GlassContent
    layout="scroll"
    ref={viewport}
    tabIndex={0}
    role="region"
    aria-label="Reading list"
    style={{ scrollPaddingBlock: 80 }}
  >
    {children}
  </GlassContent>
  <GlassScrollEdges target={viewport} size={80} blur={20} />
</GlassScene>;
```

| Prop         | Default                   | Usage                                                                  |
| ------------ | ------------------------- | ---------------------------------------------------------------------- |
| `edge`       | `"bottom"`                | Primitive edge: `top`, `bottom`, `inline-start`, or `inline-end`.      |
| `edges`      | `["top", "bottom"]`       | Scroll helper edges. Logical edges follow direction.                   |
| `target`     | Required on scroll helper | Ref to the scrolling viewport.                                         |
| `size`       | `80`                      | Edge depth in pixels, 0–4096; scroll edges clamp to half the viewport. |
| `blur`       | `20`                      | Gaussian standard deviation in pixels, 0–64.                           |
| `refraction` | `0`                       | Optical displacement in pixels, 0–32.                                  |
| `disabled`   | `false`                   | Remove the effect.                                                     |

The viewport needs an explicit height and scrolling overflow. Keep fixed headers and controls outside it, and use scroll padding so focused content can enter the clear area. Blur clears at reached edges and when there is no overflow. Reduced transparency and forced colors disable the effect. If map preparation fails, content remains readable and `onDiagnostic` reports the error.

## Content shapes and foregrounds

`GlassShape` clips images and content to continuous corners without needing a scene:

```tsx
<GlassShape radius={28} render={<img src="/cover.jpg" alt="Album cover" />} />
<GlassShape radius={40} style={{ padding: 4 }}>
  <GlassShape concentric={{ inset: 4 }} radius={8}>Nested content</GlassShape>
</GlassShape>
```

`concentric` follows the nearest declared container's outline. `GlassSurface` supports it too. Use `GlassShapeContainer` to declare geometry without clipping; `GlassCorner` positions a control near a curved corner. Both concentric shapes and corner controls accept `container={containerRef}` for siblings or portals. The container must be measurable; rotation is unsupported. Keep popups outside clipped content.

Use `GlassForeground` for ordinary DOM above the background that should refract beneath a higher glass surface. For an existing element ref, use `useGlassForeground()`. Keep overlapping content and menus in the same scene.

`GlassRow` makes any element a row of the glass panel it sits in, like a menu's items: rows in the panel's corners follow its curve moved inward, and their side padding clears it.

```tsx
<GlassSurface radius={28} className="my-list">
  {options.map((option) => (
    <GlassRow key={option.id} render={<button type="button" />}>
      {option.label}
    </GlassRow>
  ))}
</GlassSurface>
```

## Without React

```ts
import { createGlassScene } from "@glass-sdk/liquid-glass/dom";
import "@glass-sdk/liquid-glass/styles.css";

const scene = createGlassScene(document.querySelector<HTMLElement>(".lg-scene")!);
scene.setContent(document.querySelector<HTMLElement>(".lg-content")!);
const remove = scene.addSurface(document.querySelector<HTMLElement>(".lg-surface")!, {
  material: "regular",
  radius: 28,
});

// On teardown:
remove();
scene.dispose();
```

Use the positioned scene/content/surface structure from the React example. `scene.addForeground(element)` registers foreground content and returns a cleanup function. `scene.addAnimator(animator)` updates custom animation before scene measurements.

In Chromium and Electron, each surface draws its own glass as an inline `backdrop-filter` on the surface, so a change anywhere redraws only the glass over it, and glass over other glass sees that glass as it is. The surface gets inline `border-radius` and `box-shadow` (its shadow), and `clip-path: none`; its original inline values come back when it is removed. A surface with glass inside it draws its glass on a `::before` layer beneath its children instead, and gets `isolation: isolate` and a `data-glass-host` attribute, because a backdrop filter on the surface itself would hide the glass behind it from the glass inside. Such a surface should not use `::before` for anything else. An ancestor with `filter`, `opacity` below 1, `mask`, `clip-path` or `backdrop-filter` limits what a backdrop filter sees to that ancestor, so glass inside one shows only what is inside it; fade a glass surface itself rather than a wrapper. Glass well off screen draws nothing until it comes near.

In Firefox, each surface draws its own glass: the scene adds an `aria-hidden` layer as the surface's last child, beneath its other children, which paints a live `-moz-element()` view of the content and refracts it. The content layer itself is not filtered there. Firefox otherwise repaints a filtered content layer in software on every frame anything on the page animates. If the content element has no `id`, the scene gives it one while it is attached. Surfaces should not rely on `:last-child` styling of their own children.

In Safari, content that WebKit composites on its own layer, such as video, WebGL and WebGPU canvases, 3D transforms, `will-change`, running transform or opacity animations, nested glass scenes, and positioned elements over any of them, would otherwise cover the glass. While glass is over such a layer, the scene gives the layer its own copy of the glass through an inline `filter`. For `<video>` and `<canvas>` it also inserts `aria-hidden` mirror canvases just before the element and cuts the glass's shape out of the element with an inline `clip-path`. A media element with an authored `clip-path` is hidden with `opacity: 0` instead, while glass is over it. All of these are removed once the glass moves away. An element in glass content with a long-running animation that Safari repaints every frame, such as an animated gradient or `background-position` shimmer, gets `will-change: transform` while it runs, so its repaints do not re-run the glass filter of the whole content. Elements with positioned descendants are left alone, because the new layer would change their stacking. Selectors such as `:first-child` or `+` that match the media's siblings can see the mirror canvases while they are present.

The `/core`, `/gpu`, and `/dom` exports provide geometry, materials, rendering, and controller APIs for custom integrations. Type declarations describe their options.

## Requirements and limitations

- React 19+ and Base UI (`@base-ui/react`, a peer dependency) for React components; HTTPS or localhost and an available WebGPU adapter to render glass material maps. Progressive blur needs no WebGPU.
- SVG filter performance varies between browser engines. Safari can spend substantially longer filtering large content layers than Chromium, even when material maps are cached. Keep scenes close to the content they need to refract, and test moving glass on the devices you support. Chromium, Firefox, Safari, and Electron are acceptance targets; they do not have identical performance.
- For consistent refraction in Safari, give `GlassContent` an opaque background, or set `--lg-backdrop`. Transparent source pixels can leave the original content visible beneath its refracted image.
- Use bounded scenes with explicit content layers. Arbitrary page-backdrop sampling, rotated/transformed ancestors, and native ports are outside the supported scope.
- In Safari, glass over a rotated or skewed composited layer, such as an element in a rotating CSS animation, draws beneath it. Encrypted (DRM) video cannot be drawn by any page, so glass over it also draws beneath it. Cross-origin video and canvas content refract without CORS, because the mirror never reads its pixels back.
- `GlassScene.maxSurfaces` defaults to 16 and accepts at most 64. Use `onDiagnostic` for map readiness, construction timing, filter graph limits, and GPU errors.
- NodeNext TypeScript consumers currently need `skipLibCheck: true` for upstream vgpu declarations.

## How it works

vgpu renders WGSL material maps; SVG filters apply them to live DOM content: in Chromium as each surface's backdrop filter, elsewhere as a filter on the scene's content layer. Chromium copies a backdrop filter's images into every frame it draws, so there each map is cut into its four corners and the single column and row between them, which the filter stretches along the straight edges. Maps are cached and reused as surfaces move. Geometry changes prepare new maps. The library does not capture DOM screenshots. A `--lg-backdrop` color is composited beneath the content only in the area each surface samples, before frost and refraction; in Firefox it is the background color of each surface's glass layer.

## Contributing and license

See [Contributing](https://github.com/Glass-HQ/liquid-glass/blob/main/CONTRIBUTING.md). Licensed under [MIT](LICENSE).
