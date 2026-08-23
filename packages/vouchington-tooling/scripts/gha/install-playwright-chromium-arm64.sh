#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/gha/download-with-diagnostics.sh
source "${script_dir}/download-with-diagnostics.sh"

browsers_json="${PLAYWRIGHT_BROWSERS_JSON:-}"
if [ -z "$browsers_json" ] || [ ! -f "$browsers_json" ]; then
  browsers_json="node_modules/playwright/node_modules/playwright-core/browsers.json"
fi
if [ ! -f "$browsers_json" ]; then
  browsers_json=$(find node_modules -path '*/playwright-core/browsers.json' -print -quit 2>/dev/null || true)
fi
if [ -z "$browsers_json" ] || [ ! -f "$browsers_json" ]; then
  echo "::error::playwright-core/browsers.json not found; set PLAYWRIGHT_BROWSERS_JSON or install Playwright first"
  exit 1
fi

browsers_path="${PLAYWRIGHT_BROWSERS_PATH:-${HOME}/.cache/ms-playwright}"
mirror="${PLAYWRIGHT_CHROMIUM_MIRROR:-https://cdn.playwright.dev/dbazure/download/playwright/builds/chromium}"
mkdir -p "$browsers_path"

browser_revision() {
  node -e "const fs=require('node:fs'); const file=process.argv[1]; const name=process.argv[2]; const browser=JSON.parse(fs.readFileSync(file,'utf8')).browsers.find(b => b.name === name); if (!browser) { process.stderr.write('unknown browser '+name); process.exit(1) } process.stdout.write(String(browser.revision))" "$browsers_json" "$1"
}

install_browser() {
  local name="$1" archive="$2"
  local rev
  rev=$(browser_revision "$name")
  local dir="${browsers_path}/${name//-/_}-${rev}"
  local marker="${dir}/INSTALLATION_COMPLETE"

  if [ -f "$marker" ]; then
    echo "Already installed: ${name}-${rev} (cache hit)"
    return
  fi

  echo "Installing ${name} v${rev} via curl + system unzip"
  local tmp="${RUNNER_TEMP:-/tmp}/${name}-${rev}-${archive}"
  rm -f "$tmp"
  rm -rf "$dir"
  mkdir -p "$dir"
  # integrity-check: skip reason=playwright-cdn-provides-no-published-checksums
  ci_download_to "${mirror}/${rev}/${archive}" "$tmp" --retry 3 --retry-all-errors --max-time 300 --retry-max-time 300
  unzip -q "$tmp" -d "$dir"
  rm -f "$tmp"

  local exe
  case "$name" in
    chromium) exe="$dir/chrome-linux/chrome" ;;
    chromium-headless-shell) exe="$dir/chrome-linux/headless_shell" ;;
    *)
      echo "::error::install_browser: unknown browser name '$name'"
      exit 1
      ;;
  esac
  if [ ! -x "$exe" ]; then
    echo "::error::Expected ${name} binary missing or not executable after extract: $exe"
    exit 1
  fi

  touch "$marker"
  echo "Installed ${name} at ${dir}"
}

if [ "$#" -eq 0 ]; then
  install_browser chromium chromium-linux-arm64.zip
  install_browser chromium-headless-shell chromium-headless-shell-linux-arm64.zip
  exit 0
fi

while [ "$#" -gt 0 ]; do
  spec="$1"
  shift
  name="${spec%%:*}"
  archive="${spec#*:}"
  if [ -z "$name" ] || [ "$archive" = "$spec" ]; then
    echo "::error::browser spec must be name:archive, got '$spec'"
    exit 2
  fi
  install_browser "$name" "$archive"
done
