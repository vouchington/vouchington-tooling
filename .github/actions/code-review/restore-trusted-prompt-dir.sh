#!/usr/bin/env bash
# Remove the trusted checkout and restore any caller-owned directory.
set -euo pipefail
target="${GITHUB_WORKSPACE:?}/.trusted-review-prompt"
backup="${RUNNER_TEMP:?}/trusted-review-prompt-caller"
marker="${RUNNER_TEMP}/trusted-review-prompt-managed"
if [ ! -f "$marker" ]; then
  exit 0
fi
rm -rf "$target"
if [ -e "$backup" ]; then
  mv "$backup" "$target"
fi
rm -f "$marker"
