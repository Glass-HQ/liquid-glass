# Native reference

Build and open the local macOS comparison app:

```sh
bun run native
```

Requires Xcode, Apple Silicon, and macOS 26 or newer. `bun run native:build` builds without opening the app.

Choose an example in the standard SwiftUI sidebar. Each example has Preview and Install & Usage views. The app follows the website’s example order and reuses its wallpapers, player, albums, messages, and article content. The build refreshes that content from the site source; album artwork loads from the same remote URLs and requires network access.

Navigation uses `NavigationSplitView` and `List`. Preview/Usage uses a segmented `Picker`; music tabs use a standalone `NSSegmentedControl` with a capsule border and the macOS 27 `.tabs` role. Buttons use the system glass style, menus use the standard SwiftUI `Menu` button, and value controls offer SwiftUI and AppKit variants. The Toolbar example starts with playback hidden. Its capsule button shows or hides real `ToolbarItemGroup` and `ToolbarSpacer` items in the window’s toolbar; the variant picker changes their grouping.

The player surface uses SwiftUI `glassEffect` with Clear/Regular and tint. Standard controls keep Apple’s system material, with native capsule and circular button shapes. Menus offer a submenu option and a standalone or window-toolbar trigger; Apple controls popup placement. Playback and menu actions are local previews, while player dragging, tab selection, sliders, switches, library scrolling, and the message composer are interactive.

Progressive scenes use native scroll-edge effects. Apple exposes soft/hard styles, not numeric blur radii or refraction controls. The Image scene uses `NSVisualEffectView` with a Core Animation mask for a system-material fade, not a variable-radius blur.

This app has an ad hoc signature. It is a local comparison reference, not a native port or a distributable app.
