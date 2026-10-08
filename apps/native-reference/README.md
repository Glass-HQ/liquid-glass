# Native reference

A local macOS app for comparing the web examples with system Liquid Glass. It includes surfaces, buttons, toolbars, tabs, menus, sliders, and switches over the site's wallpapers.

Requires Xcode and an Apple Silicon Mac running macOS 26 or newer.

```sh
bun run native       # build and open
bun run native:build # build only
```

Clear/Regular changes the native glass surfaces; system menus and value controls use their own material. Playback and menu actions are previews, while tabs, sliders, and switches are interactive.

This comparison app uses an ad hoc signature and is not a native port or a distributable app.
