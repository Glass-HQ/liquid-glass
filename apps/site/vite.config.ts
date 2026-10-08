import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import type { Plugin } from "vite"

// A rebuilt package creates a new scene context. Reload it as one boundary.
function libraryReload(): Plugin {
  let timer: ReturnType<typeof setTimeout> | undefined
  return {
    name: "liquid-glass-package-reload",
    enforce: "pre",
    hotUpdate({ file, modules, timestamp }) {
      if (
        this.environment.name !== "client" ||
        !file.includes("/packages/liquid-glass/dist/") ||
        !file.endsWith(".js")
      )
        return
      for (const module of modules)
        this.environment.moduleGraph.invalidateModule(
          module,
          new Set(),
          timestamp,
          true
        )
      clearTimeout(timer)
      const environment = this.environment
      timer = setTimeout(
        () => environment.hot.send({ type: "full-reload" }),
        100
      )
      return []
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [libraryReload(), react(), tailwindcss()],
  css: {
    postcss: {
      plugins: [{
        postcssPlugin: "targeted-group-has",
        Rule(rule: { selector: string }) {
          // A:is(B *) and B A match identically with the same specificity.
          // Keep the target on the right so ancestor :has() invalidation does
          // not repeatedly restyle the whole page while glass shapes mount.
          rule.selector = rule.selector.replace(
            /^(&|\.(?:\\.|[\w-])+):is\((:where\(\.group[^()]*\):has\([^()]+\)) \*\)$/,
            "$2 $1",
          )
        },
      }],
    },
  },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "gpu", test: /node_modules.*(vgpu|wgpu-matrix)/ },
            {
              name: "react",
              test: /node_modules.*(react-dom|react@|scheduler)/,
            },
          ],
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
})
