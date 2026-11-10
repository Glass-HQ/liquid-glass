// Bundles what an app ships for typical imports of the built package and checks
// each against its budget. "Initial" is everything loaded with the entry. Code
// split behind a dynamic import, such as the GPU map renderer or an engine's own
// path, is budgeted per module: what loading it downloads beyond the initial
// code. Engine-specific modules never load together, so they are not summed.
//
//   node scripts/check-size.mjs            check budgets
//   node scripts/check-size.mjs --json     print measurements as JSON
//   node scripts/check-size.mjs --update   rewrite budgets to the next 512-byte step above each measurement
import { build } from "esbuild";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const packageDir = new URL("../packages/liquid-glass/", import.meta.url).pathname;
const budgetsFile = new URL("../packages/liquid-glass/size-budgets.json", import.meta.url).pathname;
const root = process.env.SIZE_PACKAGE_DIR ?? packageDir;

const scenarios = {
  "Surface": `import { GlassScene, GlassContent, GlassSurface } from "PKG";`,
  "Button": `import { GlassScene, GlassContent, GlassButton } from "PKG";`,
  "Toolbar": `import { GlassScene, GlassContent, GlassToolbar, GlassToolbarButton } from "PKG";`,
  "Tabs": `import { GlassScene, GlassContent, GlassTabs } from "PKG";`,
  "Menu": `import { GlassScene, GlassContent, GlassButton, GlassMenu, GlassMenuTrigger, GlassMenuContent, GlassMenuItem } from "PKG";`,
  "Slider and switch": `import { GlassScene, GlassContent, GlassSlider, GlassSwitch } from "PKG";`,
  "Progressive blur": `import { GlassScene, GlassProgressiveBlur } from "PKG";`,
  "Everything": `import * as all from "PKG"; export { all };`,
};

const external = ["react", "react-dom", "react/jsx-runtime", "react-dom/client"];

async function measure(name, source) {
  const dir = mkdtempSync(join(tmpdir(), "lg-size-"));
  const names = [...source.matchAll(/import \{([^}]+)\}/g)].flatMap((m) => m[1].split(",").map((s) => s.trim()));
  // Use every import so the bundler cannot drop it.
  const entry = source.replace("PKG", join(root, "dist/index.js")) + (names.length ? `\nexport { ${names.join(", ")} };` : "");
  writeFileSync(join(dir, "entry.js"), entry);
  try {
    const result = await build({
      entryPoints: [join(dir, "entry.js")], bundle: true, splitting: true, format: "esm", minify: true,
      outdir: join(dir, "out"), external, metafile: true, write: false, logLevel: "silent",
      nodePaths: [join(root, "node_modules"), join(packageDir, "node_modules"), new URL("../node_modules", import.meta.url).pathname],
      loader: { ".css": "empty" },
    });
    const files = new Map(result.outputFiles.map((f) => [f.path, f.contents]));
    const outputs = result.metafile.outputs;
    const entryOut = Object.keys(outputs).find((k) => outputs[k].entryPoint);
    const initial = new Set();
    const visit = (key) => { if (initial.has(key)) return; initial.add(key); for (const i of outputs[key].imports) if (i.kind === "import-statement" && outputs[i.path]) visit(i.path); };
    visit(entryOut);
    const sum = (keys, fn) => keys.reduce((n, k) => n + fn(files.get(join(process.cwd(), k)) ?? files.get(k) ?? new Uint8Array()), 0);
    const all = Object.keys(outputs).filter((k) => k.endsWith(".js"));
    const gz = (b) => gzipSync(b, { level: 9 }).length, br = (b) => brotliCompressSync(b).length;
    const lazy = {};
    for (const key of all) {
      const entryPoint = outputs[key].entryPoint;
      if (initial.has(key) || !entryPoint) continue;
      const loaded = new Set();
      const load = (k) => { if (loaded.has(k) || initial.has(k)) return; loaded.add(k); for (const i of outputs[k].imports) if (i.kind === "import-statement" && outputs[i.path]) load(i.path); };
      load(key);
      lazy[entryPoint.replace(/^.*\/dist\//, "").replace(/\.js$/, "")] = sum([...loaded], gz);
    }
    return { name, initialGzip: sum([...initial], gz), initialBrotli: sum([...initial], br), lazy };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const results = [];
for (const [name, source] of Object.entries(scenarios)) results.push(await measure(name, source));
const css = gzipSync(readFileSync(join(root, "dist/styles.css")), { level: 9 }).length;

if (process.argv.includes("--json")) { console.log(JSON.stringify({ results, cssGzip: css }, null, 2)); process.exit(0); }

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
let budgets = JSON.parse(readFileSync(budgetsFile, "utf8"));
if (process.argv.includes("--update")) {
  const next = { note: budgets.note, initialGzip: {}, lazyGzip: {} };
  const step = (n) => (Math.floor(n / 512) + 1) * 512;
  for (const r of results) {
    next.initialGzip[r.name] = step(r.initialGzip);
    for (const [module, size] of Object.entries(r.lazy)) next.lazyGzip[module] = Math.max(next.lazyGzip[module] ?? 0, step(size));
  }
  writeFileSync(budgetsFile, JSON.stringify(next, null, 2) + "\n");
  budgets = next;
}
let failed = false;
console.log("Import".padEnd(20), "Initial gzip".padStart(13), "Budget".padStart(10));
for (const r of results) {
  const limit = budgets.initialGzip[r.name];
  const over = !(r.initialGzip <= limit);
  failed ||= over;
  console.log(r.name.padEnd(20), kb(r.initialGzip).padStart(13), kb(limit).padStart(10), over ? "  OVER BUDGET" : "");
}
const lazy = {};
for (const r of results) for (const [module, size] of Object.entries(r.lazy)) lazy[module] = Math.max(lazy[module] ?? 0, size);
console.log("\nLoaded on demand".padEnd(25), "Gzip".padStart(9), "Budget".padStart(10));
for (const [module, size] of Object.entries(lazy).sort()) {
  const limit = budgets.lazyGzip[module];
  const over = !(size <= limit);
  failed ||= over;
  console.log(module.padEnd(24), kb(size).padStart(9), (limit === undefined ? "none" : kb(limit)).padStart(10), over ? "  OVER BUDGET" : "");
}
console.log(`styles.css: ${kb(css)} gzip. React is excluded; it is a peer dependency.`);
if (failed) { console.error("Bundle size exceeds its budget. Reduce it, or run with --update if the growth is intended."); process.exit(1); }
