# Contributing

Bug fixes, documentation improvements, and focused contributions are welcome. For substantial features or API changes, open an issue to discuss the approach first.

## Getting started

Fork the repository and install Bun 1.4.4 (the version in `.bun-version`) and [Vite+](https://viteplus.dev) 1.6, whose `vp` command runs the tools. Use Node.js 26.13.1 or later for development; `vp` installs it for you.

```sh
bun install --frozen-lockfile
vp run dev
```

The development command builds and watches the package alongside the site. Examples use the library's public exports. Read [AGENTS.md](AGENTS.md) for project constraints; keep the root `bun.lock` authoritative.

## Checks

| Command                                              | What it does                                                                                                                                             |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vp check`                                           | Formats with Oxfmt, lints with Oxlint, and type-checks. `vp check --fix` fixes what it can. Build first: the site type-checks against the built package. |
| `vp run build`                                       | Builds the package and the site.                                                                                                                         |
| `vp run test`                                        | Runs the unit tests with `bun test`.                                                                                                                     |
| `node scripts/check-packages.ts`                     | Packs the package and checks it with publint and Are the Types Wrong.                                                                                    |
| `vp run --filter @glass-sdk/liquid-glass check:size` | Checks the bundle size of typical imports against `size-budgets.json`.                                                                                   |
| `vp run --filter @glass-sdk/liquid-glass check:gpu`  | Runs the vgpu doctor, validates the shader on your GPU, and renders maps through the built package.                                                      |

`bun install` sets up Git hooks through `vp config`. The `pre-commit` hook formats staged files. The `pre-push` hook runs `scripts/pre-push.sh`: every check above, and the GPU checks when rendering code changes, so pushing rendering changes needs a machine with a GPU. Pushes that only change Markdown run `vp check` alone.

There's no CI on everyday work, on purpose: the `pre-push` hook runs every check before anything leaves your machine, so CI would only repeat the same commands. Releases run them again in `release.yml`.

Use the installed vgpu tools from `packages/liquid-glass` with `vp exec vgpu`. Start with `vp exec vgpu docs cat getting-started.md` and `docs cat shader-workflow.docs.md`; use `docs find` and `examples search` for API details.

Review rendering changes in the site's examples in Chromium, Safari, Firefox, and Electron. Check both appearances and materials. Record browser versions, observed results, and anything you could not check with your change. An unavailable GPU adapter is not a passing result. For comparison with system materials, use the [native reference app](apps/native-reference/README.md).

## Performance

`vp run bench` plays fixed scenes in real Chrome, Safari, Firefox and Electron windows and reports what each cost. A change made for speed needs a session against its base, `vp run bench --base main`, on a machine left alone while it runs. Quote the table in the commit message. A difference the session does not mark as better is noise, and is no reason for a change. See the [bench guide](apps/bench/README.md).

## Pull requests

Write commit subjects and PR titles in plain English, such as `Follow Safari page zoom`. PRs are squash-merged, so the title becomes the commit on `main`. Keep each PR focused on one problem. Explain the change and how you checked it. Include before/after screenshots for visual changes, and a recording when motion matters; attach them to the PR rather than committing them. Maintainers review and merge contributions once review conversations are resolved.

Update usage documentation when the API or requirements change. Keep implementation reports, audit logs, and scratch notes out of the repository. Include only source and assets we can distribute.

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Releases

The package keeps its current version during development; never reuse a published version.

1. Write the notes in `changelog/<version>.md`, for developers using the package: front matter with `date: YYYY-MM-DD` and `title:`, then `### New`, `### Improved`, `### Fixed` and `### Breaking changes` as needed, with code examples for API changes.
2. Complete browser review in Chromium, Safari, Firefox, and Electron.
3. Run `node scripts/release.ts <version>`. It writes the version into the package, commits `Release liquid-glass <version>`, and tags `liquid-glass@<version>`. It doesn't push.
4. Push the commit and the tag with the command it prints. The pre-push hook runs every check.

The tag starts `.github/workflows/release.yml`. It checks that the tag matches the package version, runs the build, `vp check` and the tests, builds `CHANGELOG.md` into the package, packs it, publishes it to npm through trusted publishing (skipping a version already on npm), and creates the GitHub release from the changelog entry. Run the workflow by hand for a dry run that publishes nothing.

The site consumes the workspace package. Vercel builds `apps/site/dist` using `vercel.json`.
