# Changelog

## 0.0.3

A new engine. Every glass surface is now drawn by one WebGL2 renderer in a worker, from a copy of
the page it captures itself: no `backdrop-filter` and no SVG filters, so glass looks the same in
Chrome, Safari, Firefox and Electron, and moves at the display's rate, up to 120 Hz on iPhone.

### New

- `GlassTabBar` and `GlassTab`: a floating tab bar whose selection lifts into a lens you can drag.
- `GlassSegmented` and `GlassSegmentedItem`: a segmented control.
- `GlassGroup`: glass inside it is drawn as one piece, so neighbours melt together as they near.
- `GlassColorPicker`: a hue and saturation wheel whose knob lifts into a lens while dragged.
- `GlassHighlight`: a pill inside a surface that follows a target, like the row under the pointer.
- `GlassToolbarSeparator`, and `GlassToolbarSpacer` is fixed or flexible.
- Menus morph out of their button and back into it. They render over the whole page, stay inside
  the window, scroll when long, and jump to a row as you type its first letters.
- `GlassContextMenu` and `GlassContextMenuTrigger`: the same menu, opened at the pointer.
- `specular`: the glass's highlights turn toward the pointer, or with the device's tilt. Off by
  default.
- `tintAmount` on the scene: regular glass from clear to tinted.
- Glass adapts to what is behind it, so labels on it stay readable (`adaptive`, `useGlassTone`).
- `GlassProgressiveBlur`: content softens as it scrolls under a bar, blurred most at one edge and
  not at all a little way in. The renderer draws it, like glass, so it costs what a glass surface
  of its size costs. With `replace` it works over see-through content too (a pane over a
  translucent window): it draws only what scrolls beside it, and `progressiveBlurMask` hides that
  content under it, so the sharp content never shows through the blurred copy.
- Glass far apart no longer repaints or frosts the page between it. A bar at the top and one at
  the bottom of a long page each keep their own part of the backdrop.
- The texture atlas starts small, grows as it fills, and gives pages back once content that
  scrolled away has left them mostly empty. Scrolling a long page under glass no longer holds
  hundreds of megabytes of GPU memory.
- Readings of what is behind glass are spaced out, so glass that redraws every frame doesn't
  wait on the GPU every frame.

### Breaking changes

- React components come from `@glass-sdk/liquid-glass/react`; the root entry is the scene for
  plain JavaScript (`createGlassScene`). The `/core`, `/dom`, `/gpu` and `/styles.css` entry
  points are gone, and there is no stylesheet to import: the library injects its own.
- `GlassMenuContent` is now `GlassMenuPopup`, and `GlassMenuSubmenuContent` is
  `GlassMenuSubmenuPopup`.
- `GlassTabs*` are replaced by `GlassTabBar` and `GlassSegmented`, and `GlassShapeContainer` by
  `GlassGroup`.
- `GlassContent`, `GlassScrollEdges`, `GlassCorner`, `GlassForeground`, `GlassMotion`,
  `GlassShape`, `GlassToolbarGroup`, `GlassToolbarLink`, the menu's checkbox, radio and group
  items, and the `lens` material are gone.
- Components keep their names but not all their props; see the README.
