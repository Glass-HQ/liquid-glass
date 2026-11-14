import { definePlugin } from "vite-plus/lint/plugins";

import noEmDashCopy from "./rules/no-em-dash-copy.ts";

export default definePlugin({
  meta: { name: "glass" },
  rules: {
    "no-em-dash-copy": noEmDashCopy,
  },
});
