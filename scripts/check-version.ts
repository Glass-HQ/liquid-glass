// Checks that a release tag matches every public package:
//
//   node scripts/check-version.ts liquid-glass@0.0.3
//
// Each public package must carry the tag's version, and the version must have
// a changelog entry.
import { publicPackages, readChangelogEntry, repoName, versionPattern } from "./workspace.ts";

export function versionFromTag(tag: string): string {
  const prefix = `${repoName}@`;
  if (!tag.startsWith(prefix))
    throw new Error(`Release tags look like ${prefix}<version>; received ${JSON.stringify(tag)}.`);
  const version = tag.slice(prefix.length);
  if (!versionPattern.test(version))
    throw new Error(`${JSON.stringify(version)} isn't a valid version.`);
  return version;
}

export function assertPackagesAt(
  version: string,
  packages: { name: string; version: string }[],
): void {
  const wrong = packages.filter((pkg) => pkg.version !== version);
  if (wrong.length)
    throw new Error(
      `These packages aren't at ${version}: ${wrong.map((pkg) => `${pkg.name}@${pkg.version}`).join(", ")}.`,
    );
}

if (import.meta.main) {
  const tag = process.argv[2];
  if (!tag) throw new Error("Usage: node scripts/check-version.ts <tag>");
  const version = versionFromTag(tag);
  assertPackagesAt(
    version,
    publicPackages().map((pkg) => pkg.json),
  );
  readChangelogEntry(version);
  console.log(`${tag} matches every public package and has a changelog entry.`);
}
