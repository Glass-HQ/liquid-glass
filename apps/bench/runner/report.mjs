// Turns runs into numbers a person can compare, and refuses to call a
// difference real when the repetitions of the two builds overlap.
const sum = (object) => Object.values(object ?? {}).reduce((a, b) => a + b, 0);
const median = (values) => { const sorted = [...values].sort((a, b) => a - b); const mid = sorted.length >> 1; return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2; };

const own = (cpu) => sum(cpu) - (cpu?.system ?? 0);

/** One line of metrics per run, or why the run cannot be trusted. */
export function summarize(runs) {
  return runs.map((run) => {
    const { rest, idle, active } = run;
    const invalid = run.failed
      ?? (!run.ready && run.hidden ? "the window was hidden" : undefined)
      ?? (!run.ready ? `glass never became ready${run.webgpu ? "" : " (this browser has no WebGPU)"}${run.errors?.length ? `: ${run.errors[0]}` : ""}` : undefined)
      ?? (!rest || !idle || !active ? "the run was cut short" : undefined)
      ?? (idle.frames.hidden || active.frames.hidden ? "the window was hidden" : undefined)
      ?? (idle.frames.frames / idle.frames.seconds < 20 ? "the window was not painting (covered or throttled)" : undefined);
    if (invalid) return { ...run, invalid };
    const frames = active.frames.frames;
    const above = (key) => Math.max(0, key(active) / active.seconds - key(rest) / rest.seconds);
    return {
      scene: run.scene, build: run.build, rep: run.rep,
      // CPU the browser's own processes used per second of the scene.
      cpu: own(active.cpu) / active.seconds,
      parts: Object.fromEntries(Object.entries(active.cpu).map(([group, ms]) => [group, ms / active.seconds])),
      perFrame: own(active.cpu) / Math.max(1, frames),
      // The window server and the GPU serve the whole machine, so only what
      // they used above the resting scene belongs to the glass.
      system: above((phase) => phase.cpu.system ?? 0),
      gpu: active.gpu === undefined ? undefined : above((phase) => phase.gpu),
      frames: frames / active.frames.seconds,
      slow: active.frames.p95,
      worst: active.frames.max,
      rest: own(rest.cpu) / rest.seconds,
      memory: run.memory.peak,
      growth: run.memory.end - run.memory.start,
      refresh: 1000 / idle.frames.median,
      // Counted from the filters themselves, so these two never vary with the machine.
      work: run.filters.moving.megapixels,
      redraws: run.filters.moving.redraws / active.seconds,
    };
  });
}
const metrics = [
  ["cpu", "CPU ms/s", 0], ["perFrame", "CPU ms/frame", 1], ["system", "window server ms/s", 0], ["gpu", "GPU ms/s", 0], ["frames", "frames/s", 0],
  ["slow", "slow frame ms", 1], ["worst", "worst frame ms", 0], ["rest", "CPU at rest ms/s", 0], ["memory", "peak MB", 0], ["growth", "growth MB", 0], ["work", "filter work Mpx", 1], ["redraws", "filter redraws/s", 0],
];
/** Lower is better for everything except frames per second. */
const better = (key, head, base) => key === "frames" ? head > base : head < base;
/** A build wins a metric only when every one of its runs beats every run of the other. */
export function verdict(key, head, base) {
  if (head.length < 3 || base.length < 3) return "too few runs";
  const apart = Math.min(...head) > Math.max(...base) || Math.max(...head) < Math.min(...base);
  const change = median(base) ? (median(head) - median(base)) / median(base) * 100 : 0;
  if (!apart || Math.abs(change) < 3) return "inconclusive";
  return `${change > 0 ? "+" : ""}${change.toFixed(0)}% ${better(key, median(head), median(base)) ? "better" : "worse"}`;
}
export function report(output) {
  const lines = ["", `${output.machine}, ${output.system}. ${output.reps} repetitions per scene and build.`, ...output.builds.map((b) => `  ${b.name}: ${b.label}`)];
  for (const [browser, runs] of Object.entries(output.results)) {
    const rows = summarize(runs);
    // A browser that halves its frame rate for a covered or power-saving window did not play the same scene.
    const usual = median(rows.filter((row) => !row.invalid).map((row) => row.refresh)) || 0;
    for (const row of rows) if (!row.invalid && row.refresh < usual * 0.6) row.invalid = `the window refreshed at ${row.refresh.toFixed(0)} Hz instead of ${usual.toFixed(0)}`;
    const agent = runs.find((run) => run.agent)?.agent ?? "";
    const version = /(Firefox|Version|Chrome|Electron)\/[\d.]+/.exec(/Electron/.test(agent) ? agent.replace(/Chrome\/[\d.]+ /, "") : /Version\//.test(agent) ? agent : agent.replace(/Version/, ""))?.[0] ?? "";
    const refresh = median(rows.filter((row) => !row.invalid).map((row) => row.refresh)) || 0;
    lines.push("", `## ${browser} (${version.replace("Version", "Safari")}, window refreshing at ${refresh.toFixed(0)} Hz)`, "",
      `| scene | build | ${metrics.map(([, title]) => title).join(" | ")} |`, `|---|---|${metrics.map(() => "---:").join("|")}|`);
    for (const scene of [...new Set(rows.map((row) => row.scene))]) {
      const of = (build) => rows.filter((row) => row.scene === scene && row.build === build && !row.invalid);
      for (const build of output.builds) {
        const good = of(build.name), bad = rows.filter((row) => row.scene === scene && row.build === build.name && row.invalid);
        if (!good.length) { lines.push(`| ${scene} | ${build.name} | invalid: ${bad[0]?.invalid ?? "no runs"} |`); continue; }
        const cell = ([key, , digits]) => {
          const values = good.map((row) => row[key]).filter(Number.isFinite);
          if (!values.length) return "n/a";
          const text = `${median(values).toFixed(digits)} (${Math.min(...values).toFixed(digits)} to ${Math.max(...values).toFixed(digits)})`;
          if (build.name !== "head" || output.builds.length < 2) return text;
          const base = of("base").map((row) => row[key]).filter(Number.isFinite);
          const result = base.length ? verdict(key, values, base) : "";
          return /better|worse/.test(result) ? `${text} **${result}**` : text;
        };
        lines.push(`| ${scene} | ${build.name}${bad.length ? ` (${bad.length} invalid)` : ""} | ${metrics.map(cell).join(" | ")} |`);
      }
    }
  }
  lines.push("", "Each cell is the median of the repetitions with the lowest and highest in brackets. A bold verdict means every run of one build beat every run of the other; no verdict means the difference is within the noise.");
  return lines.join("\n");
}
