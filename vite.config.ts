import { defineConfig } from "vite-plus";

const ignorePatterns = ["dist", "node_modules", "bun.lock", "*.tsbuildinfo", ".vercel/**"];

export default defineConfig({
  staged: {
    "*": "vp fmt --no-error-on-unmatched-pattern",
  },
  fmt: {
    ignorePatterns,
    sortPackageJson: {},
  },
  lint: {
    ignorePatterns,
    plugins: ["eslint", "oxc", "react", "unicorn", "typescript", "jsx-a11y"],
    categories: {
      correctness: "warn",
      suspicious: "warn",
      perf: "warn",
    },
    rules: {
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
