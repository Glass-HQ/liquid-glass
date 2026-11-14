#!/bin/sh
# Liquid Glass has no CI on everyday work: this hook is the gate before anything
# leaves the machine. Releases run the same checks again in release.yml.
set -eu

# What this push adds, read from the refs Git passes on stdin. A new branch is
# compared with where it left main.
zero=0000000000000000000000000000000000000000
changed=""
while read -r local_ref local_sha remote_ref remote_sha; do
  [ "$local_sha" = "$zero" ] && continue
  if [ "$remote_sha" = "$zero" ]; then
    base=$(git merge-base "$local_sha" origin/main 2>/dev/null || git rev-list --max-parents=0 "$local_sha" | tail -1)
  else
    base=$remote_sha
  fi
  changed="$changed
$(git diff --name-only "$base" "$local_sha")"
done
changed=$(printf '%s\n' "$changed" | sed '/^$/d' | sort -u)

if [ -z "$changed" ]; then
  echo "pre-push: nothing to check"
  exit 0
fi
if ! printf '%s\n' "$changed" | grep -qv '\.md$'; then
  echo "pre-push: only Markdown changed, checking formatting only"
  vp check
  exit 0
fi

run() {
  echo "pre-push: $*"
  "$@"
}
run bun install --frozen-lockfile
# The site and bench type-check against the built package, so build first.
run vp run build
run vp check
run node scripts/changelog.ts check
run vp run test
run node scripts/changelog.ts build
run node scripts/check-packages.ts
run vp run --filter @glass-sdk/liquid-glass check:size

# The GPU checks need a real adapter, so they only run when rendering code
# changes: the vgpu doctor, device validation of the shader, and a GPU smoke
# test of the built package.
if printf '%s\n' "$changed" | grep -qE '^(packages/liquid-glass/(src/(gpu|core)/|scripts/gpu-smoke\.mjs|package\.json|vite\.config\.ts)|bun\.lock)'; then
  run vp run --filter @glass-sdk/liquid-glass check:gpu
fi
echo "pre-push: all checks passed"
