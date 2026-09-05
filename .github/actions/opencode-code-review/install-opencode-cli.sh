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
  1.18.29-Darwin-arm64 | 1.18.29-Darwin-aarch64)
    archive="opencode-darwin-arm64.zip"
    expected_sha256="fe764f7f360c584a83e18dd5f23fb1a6b2725f5ee8854b0252fe558f7798e946"
    ;;
  1.18.29-Darwin-x86_64)
    archive="opencode-darwin-x64.zip"
    expected_sha256="9858853e7bacdbbd22c2d70c377e009dc4b354dd04f5588705411e7afb89fd2d"
    ;;
  1.18.29-Linux-aarch64 | 1.18.29-Linux-arm64)
    archive="opencode-linux-arm64.tar.gz"
    expected_sha256="70baf769395ca4e7a68924026530c390eace194f3b7e4919d4efcb2aa2eed3c0"
    ;;
  1.18.29-Linux-x86_64)
    archive="opencode-linux-x64.tar.gz"
    expected_sha256="ea800b7ff56226b70952126c9fc1e2517ca4c4b5682fd9d3f9e87449697a1194"
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
