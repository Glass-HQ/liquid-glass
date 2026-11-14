// Prepares a release on this machine. It doesn't push or publish.
//
//   node scripts/release.ts 0.0.3
//
// 1. Requires a clean working tree and changelog/<version>.md.
// 2. Writes the version into every public package (they share one version) and
//    points other packages' dependencies on them at it. `workspace:` ranges stay,
//    because packing replaces them with the version.
// 3. Refreshes bun.lock, commits "Release liquid-glass <version>", and tags
//    liquid-glass@<version>.
//
// Pushing the tag starts .github/workflows/release.yml, which publishes to npm
// and creates the GitHub release.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  compareVersions,
  productName,
  publicPackages,
  readChangelogEntry,
  repoName,
  root,
  versionPattern,
  workspacePackages,
} from "./workspace.ts";

const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

const version = process.argv[2];
if (!version || !versionPattern.test(version)) {
  throw new Error("Usage: node scripts/release.ts <version>, for example 0.0.3");
}
const tag = `${repoName}@${version}`;

if (git("status", "--porcelain")) throw new Error("Commit or stash your changes before releasing.");
if (git("tag", "--list", tag)) throw new Error(`${tag} already exists.`);
const entry = readChangelogEntry(version);

const published = publicPackages();
const names = new Set(published.map((pkg) => pkg.json.name));
for (const pkg of published) {
  if (compareVersions(version, pkg.json.version) <= 0)
    throw new Error(`${pkg.json.name} is already at ${pkg.json.version}; release a later version.`);
}

const changed: string[] = [];
for (const pkg of workspacePackages()) {
  let edited = false;
  if (names.has(pkg.json.name)) {
    pkg.json.version = version;
    edited = true;
  }
  for (const field of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    const ranges = pkg.json[field] as Record<string, string> | undefined;
    for (const name of Object.keys(ranges ?? {})) {
      if (!ranges || !names.has(name) || ranges[name]!.startsWith("workspace:")) continue;
      ranges[name] = version;
      edited = true;
    }
  }
  if (edited) {
    writeFileSync(pkg.file, `${JSON.stringify(pkg.json, null, 2)}\n`);
    changed.push(relative(root, pkg.file));
  }
}

// Keep the rewritten manifests formatted, and bun.lock, which records each
// workspace package's version, in step.
execFileSync(join(root, "node_modules/.bin/vp"), ["fmt", ...changed], {
  cwd: root,
  stdio: "inherit",
});
execFileSync("bun", ["install"], { cwd: root, stdio: "inherit" });
git("add", "bun.lock", ...changed);
git("commit", "--quiet", "-m", `Release ${repoName} ${version}`);
git("tag", "--annotate", tag, "-m", `${productName} ${version}: ${entry.title}`);

const branch = git("rev-parse", "--abbrev-ref", "HEAD");
console.log(`Committed and tagged ${tag}. Push both to publish:

  git push --atomic origin ${branch} ${tag}
`);
