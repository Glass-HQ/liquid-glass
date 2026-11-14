// Packs every public package the way a release does and checks the tarball:
// publint for package.json and file layout, Are the Types Wrong for the types
// of each export. Run `vp run build` and `node scripts/changelog.ts build` first.
//
//   node scripts/check-packages.ts
import { checkPackage, createPackageFromTarballData } from "@arethetypeswrong/core";
import { filterProblems, problemKindInfo } from "@arethetypeswrong/core/problems";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publint } from "publint";
import { formatMessage } from "publint/utils";
import { publicPackages } from "./workspace.ts";

// The packages are ESM-only, so CommonJS resolution is out of scope.
const resolutionKinds = ["node16-esm", "bundler"] as const;

let failed = false;
for (const pkg of publicPackages()) {
  const out = mkdtempSync(join(tmpdir(), "lg-pack-"));
  try {
    execFileSync("bun", ["pm", "pack", "--quiet", "--destination", out], {
      cwd: pkg.dir,
      stdio: ["ignore", "ignore", "inherit"],
    });
    const tarball = readdirSync(out).find((name) => name.endsWith(".tgz"));
    if (!tarball) throw new Error(`bun pm pack wrote no tarball for ${pkg.json.name}.`);
    const data = readFileSync(join(out, tarball));

    // Check exactly what npm would receive: the unpacked tarball.
    execFileSync("tar", ["-xzf", join(out, tarball), "-C", out]);
    const lint = await publint({
      pkgDir: join(out, "package"),
      pack: false,
      level: "suggestion",
      strict: true,
    });
    for (const message of lint.messages) {
      failed ||= message.type !== "suggestion";
      console.log(`publint ${message.type}: ${formatMessage(message, lint.pkg, { color: false })}`);
    }

    const result = await checkPackage(createPackageFromTarballData(new Uint8Array(data)));
    if (!result.types) {
      failed = true;
      console.log(`attw: ${pkg.json.name} ships no types.`);
    } else {
      const problems = resolutionKinds.flatMap((resolutionKind) =>
        filterProblems(result, { resolutionKind }).map((problem) => ({ problem, resolutionKind })),
      );
      for (const { problem, resolutionKind } of problems) {
        failed = true;
        const entrypoint = "entrypoint" in problem ? ` ${problem.entrypoint}` : "";
        console.log(
          `attw (${resolutionKind})${entrypoint}: ${problemKindInfo[problem.kind].title}`,
        );
      }
    }
    console.log(
      `${pkg.json.name}@${pkg.json.version}: ${(data.byteLength / 1024).toFixed(1)} KB packed.`,
    );
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}
if (failed) {
  console.error("Package checks failed.");
  process.exit(1);
}
console.log("Package checks passed.");
