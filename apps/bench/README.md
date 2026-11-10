# Bench

Measures what Liquid Glass costs in real browser windows: Chrome, Safari, Firefox and Electron.

```sh
bun run bench                       # every scene, every browser, 5 repetitions
bun run bench --base main           # compare the working tree against a commit
bun run bench --browsers safari --scenes drag,menu --reps 3
```

A full session takes about 20 minutes per browser, or 40 with `--base`. It opens windows and needs them visible, so leave the machine alone while it runs: other work shows up in the numbers. Close your other Safari windows first, because Safari's processes are shared by all of them. Results print as a table and are saved in `results/`.

Open `bun run --cwd apps/bench dev` (or any built scene with `?scene=drag`) to watch a scene play without measuring it.

## Scenes

Each scene isolates one cost, on a fixed 1100 × 640 stage, so a number can be traced to a cause. [scenes.json](scenes.json) names them and [src/scenes.tsx](src/scenes.tsx) builds them from the library's public exports. Motion follows the clock, not the frame count, so a build that drops frames still makes the same journey.

Add a scene when a cost has no scene of its own. Keep each one to a single moving thing.

## What is measured

| Column | Meaning |
| --- | --- |
| CPU ms/s | CPU time the browser's own processes used per second of the scene. 1000 is one core fully busy. |
| CPU ms/frame | The same cost per frame the page produced. A faster build draws more frames, so compare this before reading a higher total as a regression. |
| window server ms/s, GPU ms/s | What the system compositor and the GPU used above the resting scene. Both serve the whole machine, which is why other work must stop. GPU time is read on Apple GPUs only. |
| frames/s, slow frame, worst frame | Frames the page started, its 95th percentile gap and its longest gap. |
| CPU at rest ms/s | Cost while nothing moves and no frame is requested. This should be near zero: every page pays it all the time. |
| peak MB, growth MB | Memory of the browser's processes during the scene, and what the scene left behind. |
| filter work Mpx | The area every filter step covers in one redraw, in megapixels of the screen. Counted from the filters, so it is identical on every machine and run. Safari computes every filter on the CPU, where time follows this number. Firefox does too for a filter that contains an image or a displacement, and runs the others on the GPU, so compare this number in Firefox only between builds with the same filters. |
| filter redraws/s | Frames in which a filter changed. In Safari and Firefox this, not frames/s, is how often the glass itself updates. |

The cost is read from the operating system's process counters, not from the page. Safari and Firefox render filters after the frame callback returns, so a page that times its own frames reports a smooth run while the browser is saturated.

## How a comparison stays honest

- Builds alternate and swap order every repetition (A B, B A, A B), so heat, caches and background work land on both.
- The first run of each browser is played and discarded, and the machine rests between runs (`--rest`, 3 seconds).
- A run is rejected when its window was hidden or not painting, or when the glass never became ready.
- Every cell shows the median with the lowest and highest run. A verdict appears only when every run of one build beat every run of the other and the medians differ by 3% or more. Anything else is noise, and is left unmarked.

Numbers from one machine describe that machine. Before calling something fast, run the session on the slowest hardware you intend to support.

## Limits

- macOS is the tested host. On Linux, set `LG_BENCH_CHROME` or `LG_BENCH_FIREFOX` to a browser binary; Safari and GPU time are unavailable.
- Frames/s counts frames the page started, not frames the screen showed. A screen recording is the only way to count shown frames in Safari and Firefox.
- Scenes send synthetic pointer events. Costs that only real input triggers, such as hover effects under the system cursor, are not covered.
