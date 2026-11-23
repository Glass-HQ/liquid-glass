/**
 * Everything the React bindings need beyond React itself: the scene and the motion machines.
 * `<GlassScene>` loads this module with `import()` when it mounts, so importing the React entry
 * costs only the components; the files in `react/` may import from here with `import type` only.
 */

export { createGlassScene } from "../scene/scene";
export { computedRadii } from "../scene/surface";
export { resolveRadii } from "../core/geometry";
export { resolveColor } from "../core/color";
export { press, stretch, thumb } from "../motion/constants";
export { createPressMachine, pressShapes } from "../motion/press";
export { createLensMachine, lensShapes } from "../motion/lens";
export { createHighlightMachine, highlightShapes } from "../motion/highlight";
export { createSwitchMachine } from "../motion/switch";
export { createSliderMachine } from "../motion/slider";
export { thumbShapes } from "../motion/thumb";
export { sameShapes } from "../motion/shape";
