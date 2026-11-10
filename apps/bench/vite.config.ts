import { resolve } from "node:path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// LG_PACKAGE points the scenes at another checkout's package, so one set of
// scenes measures two builds of the library.
const library = process.env.LG_PACKAGE
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: { outDir: process.env.LG_BENCH_OUT ?? "dist", emptyOutDir: true },
  resolve: library ? {
    // The other checkout has its own node_modules; the page must still run one React.
    dedupe: ["react", "react-dom"],
    alias: [
      { find: "@glass-sdk/liquid-glass/styles.css", replacement: resolve(library, "dist/styles.css") },
      { find: "@glass-sdk/liquid-glass", replacement: resolve(library, "dist/index.js") },
    ],
  } : undefined,
})
