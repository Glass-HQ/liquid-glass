import { defineConfig } from "vite-plus";

export default defineConfig({
  // `*.glsl?raw` imports become strings; the worker is inlined with `?worker&inline`
  // so apps need no bundler setup to load it.
  worker: { format: "es" },
  build: {
    target: "es2023",
    lib: {
      entry: {
        index: "src/index.ts",
        react: "src/react/index.ts",
      },
      formats: ["es"],
    },
    rolldownOptions: {
      external: (id) => /^(react|react-dom)(\/|$)/.test(id),
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        // Name the shared chunks for what they hold instead of after one of their modules. The
        // React entry must stay small: it shares only `styles` (the CSS and slider value math)
        // with the rest, and reaches `scene` (scene, motion, core) through the lazy `engine`.
        codeSplitting: {
          groups: [
            { name: "styles", test: /\/src\/(scene\/styles|motion\/range)\.ts$/, priority: 2 },
            {
              name: "scene",
              test: /\/src\/(core|scene|motion)\/|\/src\/react\/engine\.ts$/,
              priority: 1,
            },
          ],
        },
        banner: (chunk) => (chunk.name === "react" ? '"use client";' : ""),
      },
    },
  },
});
