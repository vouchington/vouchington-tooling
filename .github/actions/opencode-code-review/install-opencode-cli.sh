#!/usr/bin/env bash
# Install a pinned OpenCode CLI release into a versioned per-job directory.
set -euo pipefail
OPENCODE_VERSION="${OPENCODE_VERSION:?OPENCODE_VERSION is required}"
OPENCODE_HOME="${OPENCODE_HOME:?OPENCODE_HOME is required}"
GITHUB_ACTION_PATH="${GITHUB_ACTION_PATH:?GITHUB_ACTION_PATH is required}"
bin_dir="${OPENCODE_HOME}/opencode-v${OPENCODE_VERSION}/bin"
mkdir -p "$bin_dir"
# Keep the version in each key so Renovate's version-only update fails tests until the matching
# release digests are reviewed and updated in the same pull request.
case "${OPENCODE_VERSION}-$(uname -s)-$(uname -m)" in
  1.18.21-Darwin-arm64 | 1.18.21-Darwin-aarch64)
    archive="opencode-darwin-arm64.zip"
    expected_sha256="72f4b6029af185eb030995cfa062d038914e3142c9aa38f714fe56448e6e87d2"
    ;;
  1.18.21-Darwin-x86_64)
    archive="opencode-darwin-x64.zip"
    expected_sha256="405559e5873a9131ff6bcafc413f46d4f199b4401f232d00bcd301d97ea7cdfc"
    ;;
  1.18.21-Linux-aarch64 | 1.18.21-Linux-arm64)
    archive="opencode-linux-arm64.tar.gz"
    expected_sha256="d30d2cba74617f4e7b96e25563c9572ffe453f9eae70fc0df16286813537ee72"
    ;;
  1.18.21-Linux-x86_64)
    archive="opencode-linux-x64.tar.gz"
    expected_sha256="d910c3ed7613bb5791a328904615d41cc25b7d3a6b470e3199ab0426a995b38a"
    ;;
  *)
    echo "Unsupported OpenCode release: ${OPENCODE_VERSION}-$(uname -s)-$(uname -m)" >&2
    exit 1
    ;;
esac
bash "${GITHUB_ACTION_PATH}/../../../packages/vouchington-tooling/scripts/gha/install-github-release.sh" \
  --repo anomalyco/opencode \
  --version "$OPENCODE_VERSION" \
  --tag-prefix v \
  --asset "$archive" \
  --bin opencode \
  --strip-components 0 \
  --expected-sha256 "$expected_sha256" \
  --bin-dir "$bin_dir"
printf 'bin=%s\n' "$bin_dir/opencode" >> "${GITHUB_OUTPUT:?}"
