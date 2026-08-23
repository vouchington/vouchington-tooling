#!/usr/bin/env bash
# Restore caller OpenCode config saved by install-review-project.sh.
set -euo pipefail
workspace="${GITHUB_WORKSPACE:?}"
backup="${RUNNER_TEMP:?}/opencode-caller-config"
marker="${RUNNER_TEMP}/opencode-review-project-installed"
if [ ! -f "$marker" ]; then
  exit 0
fi
rm -rf "${workspace}/.opencode"
rm -f "${workspace}/opencode.json" "${workspace}/opencode.jsonc"
if [ -e "${backup}/.opencode" ]; then
  mv "${backup}/.opencode" "${workspace}/.opencode"
fi
if [ -e "${backup}/opencode.json" ]; then
  mv "${backup}/opencode.json" "${workspace}/opencode.json"
fi
if [ -e "${backup}/opencode.jsonc" ]; then
  mv "${backup}/opencode.jsonc" "${workspace}/opencode.jsonc"
fi
rm -rf "$backup" "$marker"
