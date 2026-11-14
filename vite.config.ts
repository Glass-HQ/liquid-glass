import { defineConfig } from "vite-plus";

const ignorePatterns = [
  "dist",
  "node_modules",
  "bun.lock",
  "*.tsbuildinfo",
  ".claude/**",
  ".vercel/**",
  "apps/bench/.base/**",
  "apps/bench/results/**",
  "apps/native-reference/build/**",
  "packages/liquid-glass/CHANGELOG.md",
];

export default defineConfig({
  staged: {
    "*": "vp fmt --no-error-on-unmatched-pattern",
  },
  fmt: {
    ignorePatterns,
    sortPackageJson: {},
    overrides: [
      {
        files: ["apps/site/**"],
        options: {
          sortTailwindcss: {
            stylesheet: "apps/site/src/index.css",
            functions: ["cn", "cva"],
          },
        },
      },
    ],
  },
  lint: {
    // The site's shadcn/ui components are installed and updated by its CLI.
    ignorePatterns: [...ignorePatterns, "apps/site/src/components/ui/**"],
    plugins: ["eslint", "oxc", "react", "unicorn", "typescript", "jsx-a11y"],
    jsPlugins: ["./tools/oxlint/index.ts"],
    categories: {
      correctness: "warn",
      suspicious: "warn",
      perf: "warn",
    },
    rules: {
      "glass/no-em-dash-copy": "error",
      "react-in-jsx-scope": "off",
      "typescript/consistent-return": "off",
      "unicorn/consistent-function-scoping": "off",
      "unicorn/no-array-sort": "off",
    },
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
});
