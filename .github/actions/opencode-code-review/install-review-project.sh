#!/usr/bin/env bash
# Replace caller OpenCode config with the trusted review-project, keeping a restore copy.
set -euo pipefail
workspace="${GITHUB_WORKSPACE:?}"
backup="${RUNNER_TEMP:?}/opencode-caller-config"
rm -rf "$backup"
mkdir -p "$backup"
if [ -e "${workspace}/.opencode" ]; then
  mv "${workspace}/.opencode" "${backup}/.opencode"
fi
if [ -e "${workspace}/opencode.json" ]; then
  mv "${workspace}/opencode.json" "${backup}/opencode.json"
fi
if [ -e "${workspace}/opencode.jsonc" ]; then
  mv "${workspace}/opencode.jsonc" "${backup}/opencode.jsonc"
fi
cp -a "${GITHUB_ACTION_PATH:?}/review-project" "${workspace}/.opencode"
rm -rf "${workspace}/.opencode/plugins"
cp "${GITHUB_ACTION_PATH}/review-project/opencode.json" "${workspace}/opencode.json"
: > "${RUNNER_TEMP}/opencode-review-project-installed"
