# Lab

The library's playground: one page with every component over the content that is hardest to draw
glass over. It runs against the library's source, so changes show without a build;
`LG_DIST=1 bun run dev` runs it against the built package in `packages/liquid-glass/dist`.

```sh
bun run dev            # from the repo root, or `vp dev` in apps/lab
```

## Sections

| Section                 | What to look for                                                           |
| ----------------------- | -------------------------------------------------------------------------- |
| Materials               | Regular and clear glass over the same photo.                               |
| Text                    | A lens dragged over small type in several scripts, under a tab bar.        |
| Gradients               | Hard stops, a conic seam and fine stripes under one long piece of glass.   |
| Scrolling and video     | A glass header inside its scroller; a video fed as a live source.          |
| Controls                | Switch, slider, segmented control and buttons on one panel.                |
| Highlight and popup     | A highlight following the row under the pointer; a popup scaled in by CSS. |
| Emoji and right to left | Joiners, skin tones and right-to-left lines under glass.                   |
| Overlays                | A palette and a context menu that scroll their own lists.                  |
| Readability             | The same labels on regular and clear glass over hard backdrops.            |
| Stress                  | Up to 64 surfaces moving over busy content.                                |

## Settings

The "…" menu in the corner sets appearance, material, tint amount, specular highlights, auto
motion (things move by themselves) and telemetry (frame rate and timings). They live in the query
string, so a view can be linked: `?theme=dark&material=clear&tint=clear&specular&auto&hud`.
`?backdrop=` picks the readability backdrop, `?n=` and `?scroll` set up the stress test, and
`?open` opens the overlays.

Errors and warnings appear in a red box at the top left, so a screenshot shows whether the page
ran cleanly.
