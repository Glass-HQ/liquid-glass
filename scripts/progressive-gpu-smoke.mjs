import { init } from "../packages/liquid-glass/node_modules/vgpu/dist/node.js";
import { MaterialRenderer } from "../packages/liquid-glass/dist/gpu.js";
const renderer = new MaterialRenderer(await init());
try {
  for (const axis of [0, 1]) for (const reverse of [false, true]) {
    const { pixels } = await renderer.renderProgressive(axis, reverse);
    for (let x = 0; x < 256; x++) {
      const t = reverse ? 1 - x / 255 : x / 255;
      const depth = t * t * (3 - 2 * t);
      let sum = 0;
      for (let row = 0; row < 7; row++) {
        const actual = pixels[(row * 256 + x) * 4 + 3];
        const expected = Math.round(255 * Math.max(0, 1 - Math.abs(depth * 6 - row)));
        if (Math.abs(actual - expected) > 1) throw new Error(`Weight mismatch: ${axis},${reverse},${x},${row}`);
        sum += actual;
      }
      if (Math.abs(sum - 255) > 1) throw new Error(`Weights don't conserve alpha at ${x}: ${sum}`);
      const neutral = pixels[(7 * 256 + x) * 4 + (axis ? 0 : 1)];
      if (neutral !== 128) throw new Error("Displacement leaks across axis");
    }
    console.log({ axis, reverse, weights: "256 samples match CPU; alpha conserved; transverse displacement neutral" });
  }
} finally { renderer.dispose(); }
