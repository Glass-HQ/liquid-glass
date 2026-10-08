# Liquid Glass

Glass surfaces and controls for React, the web, and Electron. Clear and Regular materials support light and dark appearances and refract live content.

[Examples and component reference](https://liquid-glass.glassapp.dev/#examples) · [GitHub](https://github.com/Glass-HQ/liquid-glass)

## Install

```sh
npm install @glass-sdk/liquid-glass@~0.0.1
```

## Quick start

```tsx
import { GlassScene, GlassContent, GlassSurface, GlassButton } from "@glass-sdk/liquid-glass";
import "@glass-sdk/liquid-glass/styles.css";

export function Example() {
  return (
    <GlassScene material="regular" appearance="light" style={{ height: 320 }}>
      <GlassContent>
        <img src="/landscape.jpg" alt="Mountain lake"
          style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </GlassContent>
      <GlassSurface radius={28}
        style={{ position: "absolute", left: 24, top: 100, padding: 20 }}>
        <GlassButton onClick={() => console.log("Saved")}>Save</GlassButton>
      </GlassSurface>
    </GlassScene>
  );
}
```

Import the stylesheet once. It requires neither Tailwind nor a CSS reset. Put glass components inside `GlassScene`, with one `GlassContent` layer for the background. Text, SVG, and images in that layer stay live. In Next.js, use a client component.

## Components

| Component | Purpose |
| --- | --- |
| `GlassScene`, `GlassContent` | Scene and live background layer. |
| `GlassSurface`, `GlassButton` | Glass container and button. |
| `GlassToolbar`, `GlassToolbarButton`, `GlassToolbarLink`, `GlassToolbarGroup`, `GlassToolbarSpacer` | Keyboard-navigable toolbar. |
| `GlassTabs` | Tab bar with a moving selection indicator. |
| `GlassTabsRoot`, `GlassTabsList`, `GlassTabsTrigger`, `GlassTabsIndicator`, `GlassTabsContent` | Composable tabs and panels. |
| `GlassMenu`, `GlassMenuTrigger`, `GlassMenuContent`, `GlassMenuItem` | Menu with positioning and focus restoration. |
| `GlassMenuSubmenu`, `GlassMenuSubmenuTrigger`, `GlassMenuSubmenuContent` | Nested menus. |
| `GlassSlider`, `GlassSwitch` | Slider and switch. |
| `GlassForeground`, `useGlassForeground` | Foreground content that higher glass surfaces can refract. |
| `GlassShape`, `GlassShapeContainer`, `GlassCorner` | Continuous corners and container-relative geometry. |
| `GlassProgressiveBlur`, `GlassScrollEdges` | Progressive blur over background content and scroll edges. |

Buttons, toolbars, tabs, menus, sliders, and switches use Base UI behavior. Standard props, refs, accessible names, and state callbacks remain available. See the [component examples](https://liquid-glass.glassapp.dev/#examples) for usage and the [Base UI reference](https://base-ui.com/react/overview/quick-start) for inherited props.

## Material and motion

Set defaults on `GlassScene`; individual surfaces can override them. Menu popups default to Regular.

| Prop | Default | Usage |
| --- | --- | --- |
| `material` | `"clear"` | `"clear"` or `"regular"`. |
| `appearance` | `"light"` | `"light"` or `"dark"`. |
| `radius` | Component-specific | Continuous corner radius in CSS pixels, `"capsule"`, or `"circle"`. Generic surfaces default to 8px. |
| `refraction` | `60` | Nonnegative displacement in CSS pixels. Nested surfaces limit their default to the parent inset. |
| `tint` | None | Six-digit hex color. Colors the glass without changing text or icons. |
| `interactive` | Component-specific | Press and drag feedback; on by default for buttons, toolbars, and tab bars. |
| `fluid` | `false` | Animate the outline when layout dimensions change. |
| `morphFrom` | None | Element ref or getter for a surface's opening and closing shape. |
| `morph` | By context | `"become"` replaces its source; `"detach"` separates from it. |
| `motion` | `"full"` | `"full"`, `"reduced"`, or `"none"`; inherited from the scene. |

Slider and switch pressed thumbs default to Clear, with refraction of 5px and 7.75px respectively. Their `tint` sets the track color.

System reduced-motion preferences always apply, including with `motion="full"`. Reduced motion removes stretching and travel; `"none"` removes transitions.

Override styles with `className`, inline styles, or CSS utilities. The stylesheet uses low-specificity `:where()` selectors. Use `radius` to change corners so the material and content clip agree. Override `--lg-foreground` for text and icon colors.

## Composing controls

The `render` prop merges props, handlers, styles, and refs with your component. Custom components must forward them to their DOM element. Use transparent backgrounds to keep the glass visible.

```tsx
<GlassSurface material="clear" render={<Button onClick={save} />}>
  Save
</GlassSurface>
```

Menus stay inside their scene. Content accepts `side`, `align`, `sideOffset`, `alignOffset`, and `collisionAvoidance`; defaults are bottom/end with an 8px offset. Use `positionerProps` and `portalProps` for additional Base UI options.

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

Sliders accept a numeric `value` or `defaultValue`, `min`, `max`, `step`, `onValueChange`, and `onValueCommitted`. Defaults are 0–100 with a 0.1 step. With `ticks`, the step must divide the range evenly, with at most 100 intervals. `thumbProps` exposes input refs and accessible value text.

Switches accept Base UI switch props, including `checked`, `defaultChecked`, `onCheckedChange`, `name`, and `inputRef`. Name inputs with a label or `aria-label`. Both controls support forms, RTL, `tint`, and reduced motion.

## Progressive blur

`GlassProgressiveBlur` softens `GlassContent` at an edge. Put captions and controls outside that content layer to keep them sharp.

```tsx
<GlassScene style={{ height: 320, overflow: "hidden" }}>
  <GlassContent>
    <img src="/landscape.jpg" alt="Mountain lake"
      style={{ width: "100%", height: "100%", objectFit: "cover" }} />
  </GlassContent>
  <GlassProgressiveBlur edge="bottom" size={80} blur={20} />
</GlassScene>
```

For scrolling content, pass the actual scroll viewport to `GlassScrollEdges`:

```tsx
const viewport = useRef<HTMLDivElement>(null);

<GlassScene style={{ height: 320, overflow: "hidden" }}>
  <div ref={viewport} tabIndex={0} role="region" aria-label="Reading list"
    style={{ height: "100%", overflow: "auto", scrollPaddingBlock: 80 }}>
    <GlassContent layout="flow">{children}</GlassContent>
  </div>
  <GlassScrollEdges target={viewport} size={80} blur={20} />
</GlassScene>
```

| Prop | Default | Usage |
| --- | --- | --- |
| `edge` | `"bottom"` | Primitive edge: `top`, `bottom`, `inline-start`, or `inline-end`. |
| `edges` | `["top", "bottom"]` | Scroll helper edges. Logical edges follow direction. |
| `target` | Required on scroll helper | Ref to the scrolling viewport. |
| `size` | `80` | Edge depth in pixels, 0–4096; scroll edges clamp to half the viewport. |
| `blur` | `20` | Gaussian standard deviation in pixels, 0–64. |
| `refraction` | `0` | Optical displacement in pixels, 0–32. |
| `disabled` | `false` | Remove the effect. |

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

## Without React

```ts
import { createGlassScene } from "@glass-sdk/liquid-glass/dom";
import "@glass-sdk/liquid-glass/styles.css";

const scene = createGlassScene(document.querySelector<HTMLElement>(".lg-scene")!);
scene.setContent(document.querySelector<HTMLElement>(".lg-content")!);
const remove = scene.addSurface(document.querySelector<HTMLElement>(".lg-surface")!, {
  material: "regular", radius: 28,
});

// On teardown:
remove();
scene.dispose();
```

Use the positioned scene/content/surface structure from the React example. `scene.addForeground(element)` registers foreground content and returns a cleanup function. `scene.addAnimator(animator)` updates custom animation before scene measurements.

The `/core`, `/gpu`, and `/dom` exports provide geometry, materials, rendering, and controller APIs for custom integrations. Type declarations describe their options.

## Requirements and limitations

- React 19+ for React components; HTTPS or localhost and an available WebGPU adapter for rendering.
- **Safari has known rendering issues.** The initial release showed blank tab-example content in Safari. Chromium, Firefox, Safari, and Electron are acceptance targets; the initial publication did not establish current parity across all four.
- Use bounded scenes with explicit content layers. Arbitrary page-backdrop sampling, native video composition, rotated/transformed ancestors, and native ports are outside the supported scope. Cross-origin image policies apply.
- `GlassScene.maxSurfaces` defaults to 16 and accepts at most 64. Use `onDiagnostic` for map readiness, construction timing, and GPU errors.
- NodeNext TypeScript consumers currently need `skipLibCheck: true` for upstream vgpu declarations.

## How it works

vgpu renders WGSL material maps; SVG filters apply them to live DOM content. Maps are cached and reused as surfaces move. Geometry changes prepare new maps. The library does not capture DOM screenshots.

## Contributing and license

See [Contributing](https://github.com/Glass-HQ/liquid-glass/blob/main/CONTRIBUTING.md). Licensed under [MIT](LICENSE).
