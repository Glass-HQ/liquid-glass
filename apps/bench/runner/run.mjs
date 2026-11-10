// bun run bench [--browsers chrome,safari,firefox,electron] [--scenes drag,menu]
//               [--reps 5] [--base <git ref>] [--rest 3]
//
// Plays every scene in real browser windows and reports what each one cost.
// With --base it also builds the library at that commit and plays both builds
// turn about, so a difference is a difference between builds and not between
// a cold and a warm machine.
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { browsers } from "./browsers.mjs";
import { between, snapshot } from "./counters.mjs";
import { report, summarize } from "./report.mjs";

const bench = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(bench, "../..");
const { values: options } = parseArgs({
  options: {
    browsers: { type: "string", default: "chrome,safari,firefox,electron" },
    scenes: { type: "string" },
    reps: { type: "string", default: "5" },
    base: { type: "string" },
    rest: { type: "string", default: "3" },
    seconds: { type: "string" },
    port: { type: "string", default: "5290" },
    "skip-build": { type: "boolean", default: false },
    // Saves the filter markup of each run, to see what a browser was asked to draw.
    dump: { type: "boolean", default: false },
  },
});
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const sh = (command, args, extra = {}) => execFileSync(command, args, { cwd: root, stdio: ["ignore", "ignore", "inherit"], ...extra });
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

/** Build the scenes against the library in `checkout`, into dist/<name>. */
function build(name, checkout) {
  const library = join(checkout, "packages/liquid-glass");
  console.log(`building ${name} (${checkout === root ? "working tree" : checkout})`);
  if (checkout !== root && !existsSync(join(checkout, "node_modules"))) sh("bun", ["install", "--frozen-lockfile"], { cwd: checkout });
  sh("bun", ["run", "build"], { cwd: library });
  sh("bun", ["x", "vite", "build"], { cwd: bench, env: { ...process.env, LG_PACKAGE: library, LG_BENCH_OUT: `dist/${name}` } });
}
const builds = [];
if (options.base) {
  const commit = git("rev-parse", "--short", options.base);
  const checkout = join(bench, ".base", commit);
  if (!existsSync(checkout)) git("worktree", "add", "--detach", checkout, commit);
  if (!options["skip-build"]) build("base", checkout);
  builds.push({ name: "base", label: `${options.base} (${commit})` });
}
if (!options["skip-build"]) build("head", root);
const dirty = git("status", "--porcelain", "--", "packages") !== "";
builds.push({ name: "head", label: `${git("rev-parse", "--short", "HEAD")}${dirty ? " + uncommitted changes" : ""}` });

const sceneNames = options.scenes?.split(",") ?? Object.keys(JSON.parse(readFileSync(join(bench, "scenes.json"), "utf8")));
const reps = Number(options.reps);

// One run is one scene of one build. Builds alternate and swap order every
// repetition: A B, B A, A B. Whatever drifts over a session (heat, caches,
// background work) then lands on both builds equally.
// The first run of a browser pays for its startup, so it is played and thrown away.
const plan = [{ scene: sceneNames[0], build: builds[0].name, rep: -1 }];
for (let rep = 0; rep < reps; rep++)
  for (const scene of sceneNames)
    for (const build of rep % 2 ? [...builds].reverse() : builds) plan.push({ scene, build: build.name, rep });

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".webp": "image/webp", ".wasm": "application/wasm", ".json": "application/json" };
let session;
const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://localhost");
  if (request.method === "POST") {
    let body = "";
    request.on("data", (chunk) => body += chunk);
    request.on("end", async () => {
      const reply = await session?.[url.pathname === "/__mark" ? "mark" : "done"](JSON.parse(body));
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(reply ?? {}));
    });
    return;
  }
  const path = normalize(join(bench, "dist", url.pathname.endsWith("/") ? url.pathname + "index.html" : url.pathname));
  if (!path.startsWith(join(bench, "dist")) || !existsSync(path) || !statSync(path).isFile()) { response.writeHead(404).end(); return; }
  response.writeHead(200, { "Content-Type": types[extname(path)] ?? "application/octet-stream", "Cache-Control": "no-store" });
  createReadStream(path).pipe(response);
});
await new Promise((done) => server.listen(Number(options.port), "127.0.0.1", done));
const address = (run, index) => `http://localhost:${options.port}/${run.build}/?scene=${run.scene}&run=${index}${options.seconds ? `&seconds=${options.seconds}` : ""}${options.dump ? "&dump" : ""}`;

/** Play the whole plan in one browser. Resolves with one result per run. */
async function play(browser) {
  const results = [];
  let index = 0, handle, marks = {}, watchdog, peak = 0, sampler;
  let finish;
  const finished = new Promise((done) => finish = done);
  const arm = () => {
    clearTimeout(watchdog);
    // A run that never reports: the window is hidden, or the page crashed.
    watchdog = setTimeout(async () => {
      clearInterval(sampler);
      if (plan[index].rep >= 0) results.push({ ...plan[index], failed: "The page never finished. Its window may be hidden or minimized." });
      await handle.close();
      if (++index >= plan.length) return finish();
      marks = {}; handle = await browser.open(address(plan[index], index)); arm();
    }, 90_000);
  };
  session = {
    async mark({ run, phase, edge }) {
      if (Number(run) !== index) return;
      const taken = await snapshot(handle);
      (marks[phase] ??= {})[edge] = taken;
      if (phase === "active" && edge === "start") { peak = taken.memory; sampler = setInterval(async () => { peak = Math.max(peak, (await snapshot(handle)).memory); }, 500); }
      if (phase === "active" && edge === "end") clearInterval(sampler);
    },
    async done(page) {
      if (Number(page.run) !== index) return {};
      clearTimeout(watchdog);
      const run = plan[index];
      const phase = (name) => marks[name]?.end ? { ...between(marks[name].start, marks[name].end), frames: page[name] } : undefined;
      const result = { ...run, ready: page.ready, errors: page.errors, webgpu: page.webgpu, hidden: page.hidden, agent: page.agent, window: page.window, filters: page.filters, rest: phase("rest"), idle: phase("idle"), active: phase("active"),
        memory: marks.active?.end ? { start: marks.active.start.memory, end: marks.active.end.memory, peak: Math.max(peak, marks.active.end.memory) } : undefined };
      const line = summarize([result])[0];
      if (run.rep >= 0) results.push(result);
      if (run.rep >= 0 || line.invalid) console.log(`  ${browser.name} ${run.scene} ${run.build} #${run.rep + 1}: ${line.invalid ?? `${Math.round(line.cpu)} ms CPU/s, ${line.frames.toFixed(0)} frames/s, worst frame ${Math.round(line.worst)} ms`}`);
      marks = {};
      if (++index >= plan.length) { finish(); return { next: null }; }
      await sleep(Number(options.rest) * 1000);
      arm();
      return { next: address(plan[index], index) };
    },
  };
  handle = await browser.open(address(plan[0], 0));
  arm();
  await finished;
  clearTimeout(watchdog);
  await sleep(300);
  await handle.close();
  return results;
}

const all = {};
for (const name of options.browsers.split(",")) {
  const browser = browsers[name];
  if (!browser?.available()) { console.log(`${name}: not installed, skipped`); continue; }
  console.log(`${name}: ${plan.length} runs`);
  all[name] = await play(browser);
}
server.close();

const output = {
  date: new Date().toISOString(),
  machine: process.platform === "darwin" ? execFileSync("sysctl", ["-n", "machdep.cpu.brand_string"], { encoding: "utf8" }).trim() : process.arch,
  system: process.platform === "darwin" ? `macOS ${execFileSync("sw_vers", ["-productVersion"], { encoding: "utf8" }).trim()}` : process.platform,
  builds, reps, results: all,
};
mkdirSync(join(bench, "results"), { recursive: true });
const file = join(bench, "results", `${output.date.replace(/[:.]/g, "-")}.json`);
writeFileSync(file, JSON.stringify(output, null, 1));
console.log(report(output));
console.log(`\nSaved ${file} (${readdirSync(join(bench, "results")).length} result files)`);
process.exit(0);
