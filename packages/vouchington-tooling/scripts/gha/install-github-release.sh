#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: install-github-release.sh --repo owner/name --version VERSION --asset TEMPLATE --bin NAME [--tag-prefix PREFIX] [--strip-components N]" >&2
}

REPO="${REPO:-}"
VERSION="${VERSION:-}"
ASSET_TEMPLATE="${ASSET_TEMPLATE:-}"
BIN_NAME="${BIN_NAME:-}"
TAG_PREFIX="${TAG_PREFIX:-}"
STRIP_COMPONENTS="${STRIP_COMPONENTS:-1}"

if [ -n "${RELEASE_OWNER:-}" ] && [ -n "${RELEASE_REPO:-}" ]; then
  REPO="${RELEASE_OWNER}/${RELEASE_REPO}"
fi

while [ "${#}" -gt 0 ]; do
  case "$1" in
    --repo)
      [ "${#}" -ge 2 ] || { usage; exit 2; }
      REPO="$2"
      shift 2
      ;;
    --version)
      [ "${#}" -ge 2 ] || { usage; exit 2; }
      VERSION="$2"
      shift 2
      ;;
    --asset)
      [ "${#}" -ge 2 ] || { usage; exit 2; }
      ASSET_TEMPLATE="$2"
      shift 2
      ;;
    --bin)
      [ "${#}" -ge 2 ] || { usage; exit 2; }
      BIN_NAME="$2"
      shift 2
      ;;
    --tag-prefix)
      [ "${#}" -ge 2 ] || { usage; exit 2; }
      TAG_PREFIX="$2"
      shift 2
      ;;
    --strip-components)
      [ "${#}" -ge 2 ] || { usage; exit 2; }
      STRIP_COMPONENTS="$2"
      shift 2
      ;;
    -h | --help)
      usage
      exit 2
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

if [ -z "$REPO" ] || [ -z "$VERSION" ] || [ -z "$ASSET_TEMPLATE" ] || [ -z "$BIN_NAME" ]; then
  usage
  exit 2
fi

if [[ ! "$REPO" =~ ^[^/]+/[^/]+$ ]]; then
  echo "install-github-release.sh: --repo must be owner/name" >&2
  exit 2
fi

if ! [[ "$STRIP_COMPONENTS" =~ ^[0-9]+$ ]]; then
  echo "install-github-release.sh: --strip-components must be a non-negative integer" >&2
  exit 2
fi

BIN_DIR="${RUNNER_TEMP:-${HOME}/.local}/bin"
mkdir -p "$BIN_DIR"
if [ -n "${GITHUB_PATH:-}" ]; then
  echo "$BIN_DIR" >> "$GITHUB_PATH"
fi

already_installed() {
  local output
  output="$("$BIN_DIR/$BIN_NAME" --version 2>/dev/null || true)"
  printf '%s\n' "$output" | awk -v v="$VERSION" '
    {
      n = split($0, parts, /[^0-9A-Za-z.-]+/)
      for (i = 1; i <= n; i++) if (parts[i] == v) found = 1
    }
    END { exit found ? 0 : 1 }
  '
}

if [ -f "$BIN_DIR/$BIN_NAME" ] && already_installed; then
  echo "$BIN_NAME $VERSION already installed"
  exit 0
fi

if [ -n "${PLATFORM:-}" ]; then
  RELEASE_PLATFORM="$PLATFORM"
else
  case "$(uname)-$(uname -m)" in
    Darwin-arm64) RELEASE_PLATFORM=aarch64-apple-darwin ;;
    Darwin-x86_64) RELEASE_PLATFORM=x86_64-apple-darwin ;;
    Linux-x86_64) RELEASE_PLATFORM=x86_64-unknown-linux-gnu ;;
    Linux-aarch64) RELEASE_PLATFORM=aarch64-unknown-linux-gnu ;;
    *)
      echo "Unsupported platform: $(uname)-$(uname -m)" >&2
      exit 1
      ;;
  esac
fi

asset_name="$ASSET_TEMPLATE"
asset_name="${asset_name//\{version\}/${VERSION}}"
asset_name="${asset_name//\{platform\}/${RELEASE_PLATFORM}}"
base_url="https://github.com/${REPO}/releases/download/${TAG_PREFIX}${VERSION}"
archive="${RUNNER_TEMP:-/tmp}/${BIN_NAME}-${VERSION}-${RELEASE_PLATFORM}.tar.gz"
extract_dir="${RUNNER_TEMP:-/tmp}/${BIN_NAME}-${VERSION}-${RELEASE_PLATFORM}"

rm -rf "$extract_dir"
mkdir -p "$extract_dir"
curl -fsSL -o "$archive" "${base_url}/${asset_name}"
curl -fsSL -o "${archive}.sha256" "${base_url}/${asset_name}.sha256"
expected=$(awk '{print $1}' "${archive}.sha256")
if command -v sha256sum >/dev/null 2>&1; then
  echo "${expected}  ${archive}" | sha256sum -c -
else
  echo "${expected}  ${archive}" | shasum -a 256 -c -
fi
rm "${archive}.sha256"
tar -xzf "$archive" -C "$extract_dir" --strip-components="$STRIP_COMPONENTS"
mv "$extract_dir/$BIN_NAME" "$BIN_DIR/$BIN_NAME"
chmod +x "$BIN_DIR/$BIN_NAME"
rm -rf "$archive" "$extract_dir"
