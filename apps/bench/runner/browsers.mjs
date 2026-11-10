// The browsers a release has to pass in. Each opens as a person would open
// it: a real window, a fresh profile, no flags that change how it renders.
import { execFile, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const first = (...paths) => paths.find((path) => path && existsSync(path));
const width = 1280, height = 900;
const windowServer = (process) => /\/WindowServer\b/.test(process.command);

/** A browser started as a child process: its processes are its descendants. */
function spawned(name, binary, args, { roles, prepare } = {}) {
  return {
    name,
    available: () => Boolean(binary),
    async open(url) {
      const profile = mkdtempSync(join(tmpdir(), `lg-bench-${name}-`));
      prepare?.(profile);
      const child = spawn(binary, args(profile, url), { stdio: "ignore" });
      const role = (command) => roles.find(([pattern]) => pattern.test(command))?.[1] ?? "browser";
      return {
        classify(list) {
          const family = new Set([child.pid]);
          for (let grew = true; grew;) { grew = false; for (const p of list) if (!family.has(p.pid) && family.has(p.parent)) { family.add(p.pid); grew = true; } }
          return list.flatMap((p) => family.has(p.pid) ? [[p, role(p.command)]] : windowServer(p) ? [[p, "system"]] : []);
        },
        async close() { child.kill(); await new Promise((done) => setTimeout(done, 800)); rmSync(profile, { recursive: true, force: true }); },
      };
    },
  };
}
const chromiumRoles = [[/--type=gpu-process/, "gpu"], [/--type=renderer/, "page"]];
const env = process.env;
const chrome = spawned("chrome",
  first(env.LG_BENCH_CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome"),
  (profile, url) => [`--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", `--window-size=${width},${height}`, "--window-position=0,30", url],
  { roles: chromiumRoles });
const electron = spawned("electron",
  first(env.LG_BENCH_ELECTRON, resolve(here, "../../../node_modules/.bin/electron")),
  (profile, url) => [join(here, "electron.cjs"), url, profile, String(width), String(height)],
  { roles: chromiumRoles });
const firefox = spawned("firefox",
  first(env.LG_BENCH_FIREFOX, "/Applications/Firefox.app/Contents/MacOS/firefox", "/Applications/Zen.app/Contents/MacOS/zen", "/usr/bin/firefox"),
  (profile, url) => ["-profile", profile, "-no-remote", "-new-instance", "-width", String(width), "-height", String(height), url],
  {
    roles: [[/\bgpu$/, "gpu"], [/\btab$/, "page"]],
    // First-run pages only. Nothing here changes rendering.
    prepare: (profile) => writeFileSync(join(profile, "user.js"), [
      ["browser.shell.checkDefaultBrowser", false], ["browser.aboutwelcome.enabled", false], ["datareporting.policy.dataSubmissionEnabled", false],
      ["browser.startup.homepage_override.mstone", "ignore"], ["startup.homepage_welcome_url", ""], ["browser.tabs.warnOnClose", false],
      ["zen.welcome-screen.seen", true], ["app.update.enabled", false],
      ["browser.preonboarding.enabled", false], ["termsofuse.bypassNotification", true],
      // LG_BENCH_FIREFOX_PREFS='{"some.pref":true}' tries a preference Firefox does not ship enabled.
      ...Object.entries(JSON.parse(env.LG_BENCH_FIREFOX_PREFS ?? "{}")),
    ].map(([key, value]) => `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`).join("\n")),
  });
/** Safari has one profile and its processes belong to the system, so the
 * numbers include every other Safari window. Close them before a run. */
const safari = {
  name: "safari",
  available: () => process.platform === "darwin",
  async open(url) {
    const script = (source) => exec("osascript", ["-e", `tell application "Safari"\n${source}\nend tell`]).then((result) => result.stdout.trim());
    const id = await script(`activate\nmake new document with properties {URL:${JSON.stringify(url)}}\nset bounds of front window to {0, 30, ${width}, ${height + 30}}\nreturn id of front window`);
    return {
      classify: (list) => list.flatMap((p) =>
        /com\.apple\.WebKit\.GPU/.test(p.command) ? [[p, "gpu"]]
          : /com\.apple\.WebKit\.WebContent/.test(p.command) ? [[p, "page"]]
          : /Safari\.app\/Contents\/MacOS\/Safari|com\.apple\.WebKit\.Networking/.test(p.command) ? [[p, "browser"]]
          : windowServer(p) ? [[p, "system"]] : []),
      close: () => script(`close (first window whose id is ${id})`).catch(() => {}),
    };
  },
};
export const browsers = { chrome, safari, firefox, electron };
