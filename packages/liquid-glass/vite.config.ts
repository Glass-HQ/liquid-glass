import { defineConfig } from "vite";
import { wgslVitePlugin } from "@vgpu/wgsl/loader-vite";
export default defineConfig({
  plugins: [
    wgslVitePlugin(),
    {
      name: "portable-shader-paths",
      generateBundle(_, bundle) {
        for (const output of Object.values(bundle))
          if (output.type === "chunk")
            output.code = output.code.replaceAll(
              `${import.meta.dirname}/src/gpu/maps.wgsl`,
              "liquid-glass/maps.wgsl",
            );
      },
    },
  ],
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
        banner: (chunk) => (chunk.name === "index" || chunk.name.startsWith("react/") ? '"use client";' : ""),
      },
    },
  },
});
