import { wgslVitePlugin } from "@vgpu/wgsl/loader-vite";
import { defineConfig } from "vite-plus";

export default defineConfig({
  // The loader prepares each shader at build time and fails the build on WGSL
  // parse or layout errors. `vp run check:gpu` validates it on a real device.
  plugins: [wgslVitePlugin({ minify: true })],
  build: {
    lib: {
      entry: {
        index: "src/index.ts",
        core: "src/core/index.ts",
        gpu: "src/gpu/index.ts",
        dom: "src/dom/index.ts",
      },
      formats: ["es"],
    },
    rolldownOptions: {
      external: (id) =>
        /^(react|react-dom|vgpu|@lisse\/(?:core|react)|@base-ui\/react)(\/|$)/.test(id),
      output: {
        // One output file per source module, so an app's bundler can drop the
        // components and engine code it never imports.
        preserveModules: true,
        preserveModulesRoot: "src",
        entryFileNames: "[name].js",
        banner: (chunk) =>
          chunk.name === "index" || chunk.name.startsWith("react/") ? '"use client";' : "",
      },
    },
  },
});
