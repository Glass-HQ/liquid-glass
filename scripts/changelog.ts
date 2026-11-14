// The release side of the changelog:
//
//   node scripts/changelog.ts check            every entry in changelog/ is well formed
//   node scripts/changelog.ts build            write CHANGELOG.md into each public package
//   node scripts/changelog.ts notes <version>  that release's notes, for its GitHub release
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { stdout } from "node:process";
import { publicPackages, readChangelog, readChangelogEntry } from "./workspace.ts";

const [command, version] = process.argv.slice(2);
switch (command) {
  case "check": {
    const entries = readChangelog();
    stdout.write(`Changelog is complete: ${entries.length} releases.\n`);
    break;
  }
  case "build": {
    const entries = readChangelog();
    const text = [
      "# Changelog",
      ...entries.map(
        (entry) => `## ${entry.version}: ${entry.title}\n\n_${entry.date}_\n\n${entry.body}`,
      ),
    ].join("\n\n");
    for (const pkg of publicPackages()) {
      writeFileSync(join(pkg.dir, "CHANGELOG.md"), `${text}\n`);
      stdout.write(`Wrote ${pkg.json.name}'s CHANGELOG.md with ${entries.length} releases.\n`);
    }
    break;
  }
  case "notes": {
    if (!version) throw new Error("Usage: node scripts/changelog.ts notes <version>");
    const entry = readChangelogEntry(version);
    stdout.write(`## ${entry.title}\n\n${entry.body}\n`);
    break;
  }
  default:
    throw new Error("Usage: node scripts/changelog.ts check | build | notes <version>");
}
