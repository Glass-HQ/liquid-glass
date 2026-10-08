import { spawn, spawnSync } from "node:child_process";
import { copyFile } from "node:fs/promises";
import { watch } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "..");
const library = resolve(root, "packages/liquid-glass");
const built = spawnSync("bun", ["run", "--cwd", library, "build"], {
  cwd: root,
  stdio: "inherit",
});
if (built.status !== 0) process.exit(built.status ?? 1);
const children = new Set();
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  styleWatcher.close();
  for (const child of children) {
    try {
      if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"]);
      else process.kill(-child.pid, "SIGTERM");
    } catch { /* The child may already have exited. */ }
  }
  process.exitCode = code;
}
function start(args, cwd = root) {
  const child = spawn("bun", args, { cwd, stdio: "inherit", detached: process.platform !== "win32" });
  children.add(child);
  child.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on("exit", (code) => {
    children.delete(child);
    if (!stopping) stop(code ?? 1);
  });
}
const styleWatcher = watch(
  resolve(library, "src"),
  { persistent: false },
  (_event, name) => {
    if (name === "styles.css")
      copyFile(
        resolve(library, "src/styles.css"),
        resolve(library, "dist/styles.css"),
      ).catch((error) => console.error(error.message));
  },
);
start(["run", "--cwd", library, "dev"]);
start(
  ["x", "tsc", "-p", "tsconfig.json", "--watch", "--preserveWatchOutput"],
  library,
);
start(["run", "--cwd", "apps/site", "dev", ...process.argv.slice(2)]);
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
