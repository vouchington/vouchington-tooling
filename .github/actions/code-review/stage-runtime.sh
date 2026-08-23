#!/usr/bin/env bash
# Copy the action + payload CLI out of the workspace before Claude runs.
set -euo pipefail
src="$(cd "${GITHUB_ACTION_PATH:?}/../../.." && pwd)"
dest="${RUNNER_TEMP:?}/vouchington-tooling-runtime"
rm -rf "$dest"
mkdir -p "$dest/.github/actions" "$dest/packages/vouchington-tooling/src"
cp "$src/.nvmrc" "$dest/"
cp -R "$src/.github/actions/code-review" "$dest/.github/actions/"
cp -R "$src/packages/vouchington-tooling/src/gha-review-payload" \
  "$dest/packages/vouchington-tooling/src/"
action="$dest/.github/actions/code-review"
{
  printf 'root=%s\n' "$dest"
  printf 'action=%s\n' "$action"
} >> "${GITHUB_OUTPUT:?}"
{
  printf 'VOUCHINGTON_TOOLING_ROOT=%s\n' "$dest"
  printf 'VOUCHINGTON_ACTION_PATH=%s\n' "$action"
} >> "${GITHUB_ENV:?}"
