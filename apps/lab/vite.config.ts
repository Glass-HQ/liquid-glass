import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

const library = (path: string) =>
  fileURLToPath(new URL(`../../packages/liquid-glass/${path}`, import.meta.url));

// LG_DIST=1 runs the lab against the built package (packages/liquid-glass/dist) instead of its
// source, to measure exactly what ships.
const useDist = process.env.LG_DIST === "1";

export default defineConfig({
  base: "./",
  plugins: [react()],
  worker: { format: "es" },
  server: { host: true },
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: useDist
      ? []
      : [
          { find: /^@glass-sdk\/liquid-glass\/react$/, replacement: library("src/react/index.ts") },
          { find: /^@glass-sdk\/liquid-glass$/, replacement: library("src/index.ts") },
        ],
  },
  build: { target: "es2023", outDir: "dist", emptyOutDir: true },
});
