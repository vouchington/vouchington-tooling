#!/usr/bin/env bash
# Move a caller-owned .trusted-review-prompt aside before checkout.
set -euo pipefail
target="${GITHUB_WORKSPACE:?}/.trusted-review-prompt"
backup="${RUNNER_TEMP:?}/trusted-review-prompt-caller"
marker="${RUNNER_TEMP}/trusted-review-prompt-managed"
rm -rf "$backup"
if [ -e "$target" ]; then
  mv "$target" "$backup"
fi
: > "$marker"
