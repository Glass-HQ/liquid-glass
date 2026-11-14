// Shared by the release scripts: the repository's name, its public packages,
// and its changelog entries.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const root = new URL("..", import.meta.url).pathname;
/** The name in release commits and tags: `liquid-glass@0.0.3`. */
export const repoName = "liquid-glass";
export const productName = "Liquid Glass";

export interface PackageJson {
  name: string;
  version: string;
  private?: boolean;
  files?: string[];
  [field: string]: unknown;
}
export interface WorkspacePackage {
  dir: string;
  file: string;
  json: PackageJson;
}

/** Every workspace package, public or not. */
export function workspacePackages(): WorkspacePackage[] {
  return ["apps", "packages"].flatMap((group) =>
    readdirSync(join(root, group), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(root, group, entry.name))
      .filter((dir) => readdirSync(dir).includes("package.json"))
      .map((dir) => {
        const file = join(dir, "package.json");
        const json: PackageJson = JSON.parse(readFileSync(file, "utf8"));
        return { dir, file, json };
      }),
  );
}

/** The packages published to npm. They share one version. */
export function publicPackages(): WorkspacePackage[] {
  return workspacePackages().filter((pkg) => pkg.json.private !== true);
}

export const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export interface ChangelogEntry {
  version: string;
  date: string;
  title: string;
  body: string;
}

const changelogDir = join(root, "changelog");

/** Reads `changelog/<version>.md`, checking its front matter. */
export function readChangelogEntry(version: string): ChangelogEntry {
  const file = join(changelogDir, `${version}.md`);
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    throw new Error(`changelog/${version}.md is missing. Write the release notes first.`);
  }
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!match) throw new Error(`changelog/${version}.md needs front matter with date and title.`);
  const fields = Object.fromEntries(
    match[1]!.split("\n").map((line) => {
      const colon = line.indexOf(":");
      return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
    }),
  );
  const date = fields.date ?? "";
  const title = fields.title ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw new Error(`changelog/${version}.md needs a date: YYYY-MM-DD.`);
  if (!title) throw new Error(`changelog/${version}.md needs a title.`);
  const body = match[2]!.trim();
  if (!body) throw new Error(`changelog/${version}.md has no notes.`);
  return { version, date, title, body };
}

/** Every changelog entry, newest first. */
export function readChangelog(): ChangelogEntry[] {
  return readdirSync(changelogDir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => name.slice(0, -".md".length))
    .map((version) => {
      if (!versionPattern.test(version))
        throw new Error(`changelog/${version}.md isn't named after a version.`);
      return readChangelogEntry(version);
    })
    .sort((a, b) => compareVersions(b.version, a.version));
}

export function compareVersions(a: string, b: string): number {
  const parse = (version: string) => {
    const [core = "", pre] = version.split("-", 2);
    return { parts: core.split(".").map(Number), pre };
  };
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < 3; i++) {
    const difference = (left.parts[i] ?? 0) - (right.parts[i] ?? 0);
    if (difference !== 0) return difference;
  }
  if (left.pre === right.pre) return 0;
  if (left.pre === undefined) return 1;
  if (right.pre === undefined) return -1;
  return left.pre.localeCompare(right.pre, "en", { numeric: true });
}
