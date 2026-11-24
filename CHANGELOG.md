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
- `GlassProgressiveBlur` deepens towards its edge in five layers of the browser's backdrop blur,
  each reaching less far in, so content softens gradually and its colours run together at the
  edge. `GlassProgressiveBlurFilter` draws the same blur as an SVG filter on the element itself,
  for surfaces that are see-through, where a blur laid over them would let the sharp content
  show. Neither needs a glass scene.

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
