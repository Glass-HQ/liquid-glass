# Liquid Glass

This repository holds `@glass-sdk/liquid-glass`, glass surfaces and controls for React, the web, and Electron, published to npm from `packages/liquid-glass`. `apps/site` is the examples site (deployed by Vercel), `apps/bench` the cross-browser benchmark, `apps/native-reference` a local macOS comparison app, and `scripts` the repository's release and check scripts.

## Commands

Bun 1.4.4 installs packages (`.bun-version`); Vite+ (`vp`) runs everything else on Node.js 26.

| Command                                              | What it does                                                                                   |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `bun install --frozen-lockfile`                      | Installs dependencies and sets up the Git hooks.                                               |
| `vp run dev`                                         | Builds and watches the package alongside the site.                                             |
| `vp check`                                           | Formats, lints, and type-checks. `vp check --fix` fixes what it can. Run `vp run build` first. |
| `vp run build`                                       | Builds every package.                                                                          |
| `vp run test`                                        | Runs the tests with `bun test`.                                                                |
| `node scripts/check-packages.ts`                     | Checks the packed package with publint and Are the Types Wrong.                                |
| `vp run --filter @glass-sdk/liquid-glass check:size` | Checks bundle sizes against `packages/liquid-glass/size-budgets.json`.                         |
| `vp run --filter @glass-sdk/liquid-glass check:gpu`  | vgpu doctor, shader validation on the GPU, and a GPU smoke test of the built package.          |
| `vp run bench`                                       | Measures the scenes in real browser windows ([guide](apps/bench/README.md)).                   |

## Checks without CI

There's no CI on everyday work, on purpose: [Contributing](CONTRIBUTING.md#checks) explains why. Don't add it back. The `pre-commit` hook formats staged files, and the `pre-push` hook (`scripts/pre-push.sh`) runs every check and blocks a push that fails. Run the checks yourself before you push, and fix what fails rather than skipping the hook.

## Releases and changelog

Every published version has an entry in `changelog/<version>.md`: front matter with `date: YYYY-MM-DD` and `title:`, then `### New`, `### Improved`, `### Fixed` and `### Breaking changes` as needed. Write it for developers using the package, with code examples for API changes. `node scripts/release.ts <version>` requires that entry, sets the version, commits `Release liquid-glass <version>`, and tags `liquid-glass@<version>`. It doesn't push; pushing the tag runs `.github/workflows/release.yml`, which publishes to npm and creates the GitHub release.

## Writing

Write plain English, in commit messages too: subjects like `Follow Safari page zoom`, not Conventional Commits. Avoid em dashes in written copy; use a comma, colon, parentheses, or a new sentence. Oxlint's `glass/no-em-dash-copy` rule enforces this in code.

Write documentation for someone using or contributing to the library. Lead with installation and a working example; explain props, requirements, and surprising limitations. Keep architecture secondary and avoid repeating what types or code already explain. Rewrite outdated sections instead of appending implementation histories. Keep conversational references, plans, audit logs, and publication receipts out of repository documentation. Put verification evidence in commit messages. Add a document only when it has a distinct, durable purpose.

## Project notes

- Use Bun workspaces and TypeScript. Keep the root `bun.lock` authoritative, and shared versions in the root `catalog`.
- Use vgpu and WGSL for production GPU rendering. At setup or upgrade time, use the latest released vgpu and read its bundled documentation (`vp exec vgpu docs` in `packages/liquid-glass`). For shader development, use the official vgpu skill and project-local tools: docs, examples, doctor, required WGSL validation, and real GPU readbacks.
- Everything must work by default for every user of the target browsers: no browser flags, origin trials, or opt-in APIs such as HTML-in-Canvas. Glass must look the same in each engine. Engine-specific render paths are welcome when they keep that look and are measured and verified in each engine. Refract live DOM with SVG filters; do not use DOM screenshots, WebGL/GLSL, or CSS approximations of the material.
- Chromium, Safari, Firefox, and Electron are release acceptance targets. A result in one browser does not prove parity.
- Use shadcn/ui Mira components installed through its CLI for site controls, and Hugeicons for icons.
- Keep the public site to one library, a short introduction, interactive examples, and usage. Do not add pricing, accounts, status chips, decorative feature grids, or a separate showcase renderer. Examples must use the library's public exports.
- Native and React Native ports are outside the initial scope. Keep the macOS app as a local comparison reference.
- Publish only our source, measurements we own, and permitted assets. Never commit extracted framework binaries or disassembly.
- Measure performance with `vp run bench`; keep measuring tools and scenes in `apps/bench`, not in scratch folders outside the repository. Claim a gain only where the session marks one, and say which browsers and which machine it ran on. Timings in Safari and Firefox are noisy because both saturate the CPU: read `filter work` and `filter redraws/s` there first.
