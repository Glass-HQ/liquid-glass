// Validates the shader on this machine's GPU with `vgpu check --require-validation`
// and prints its verdict instead of the full reflection report.
import { spawnSync } from "node:child_process";

const shader = "src/gpu/maps.wgsl";
const run = spawnSync("vgpu", ["check", shader, "--require-validation"], { encoding: "utf8" });
let report;
try {
  report = JSON.parse(run.stdout);
} catch {
  process.stderr.write(run.stdout + run.stderr);
  process.exit(run.status || 1);
}
for (const diagnostic of report.diagnostics) console.log(diagnostic);
console.log(`${shader}: device validation ${report.validation.ok ? "passed" : "failed"}`);
if (run.status !== 0 || !report.validation.ok) process.exit(run.status || 1);
