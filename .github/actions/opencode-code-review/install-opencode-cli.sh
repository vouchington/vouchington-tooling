#!/usr/bin/env bash
# Install a pinned OpenCode CLI release into a versioned per-job directory.
set -euo pipefail
OPENCODE_VERSION="${OPENCODE_VERSION:?OPENCODE_VERSION is required}"
OPENCODE_HOME="${OPENCODE_HOME:?OPENCODE_HOME is required}"
GITHUB_ACTION_PATH="${GITHUB_ACTION_PATH:?GITHUB_ACTION_PATH is required}"
bin_dir="${OPENCODE_HOME}/opencode-v${OPENCODE_VERSION}/bin"
mkdir -p "$bin_dir"
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64 | Darwin-aarch64) archive="opencode-darwin-arm64.zip" ;;
  Darwin-x86_64) archive="opencode-darwin-x64.zip" ;;
  Linux-aarch64 | Linux-arm64) archive="opencode-linux-arm64.tar.gz" ;;
  Linux-x86_64) archive="opencode-linux-x64.tar.gz" ;;
  *)
    echo "Unsupported platform: $(uname -s)-$(uname -m)" >&2
    exit 1
    ;;
esac
# integrity-check: skip reason=opencode-releases-no-checksums
bash "${GITHUB_ACTION_PATH}/../../../packages/vouchington-tooling/scripts/gha/install-github-release.sh" \
  --repo anomalyco/opencode \
  --version "$OPENCODE_VERSION" \
  --tag-prefix v \
  --asset "$archive" \
  --bin opencode \
  --strip-components 0 \
  --no-checksum \
  --bin-dir "$bin_dir"
printf 'bin=%s\n' "$bin_dir/opencode" >> "${GITHUB_OUTPUT:?}"
