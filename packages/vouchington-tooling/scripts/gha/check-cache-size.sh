#!/usr/bin/env bash
set -euo pipefail

if [ "${#}" -ne 3 ]; then
  echo "usage: check-cache-size.sh <path> <max-bytes> <label>" >&2
  exit 2
fi

if [ -z "${GITHUB_OUTPUT:-}" ]; then
  echo 'GITHUB_OUTPUT must be set' >&2
  exit 2
fi

CACHE_PATH="$1"
CACHE_SAVE_MAX_BYTES="$2"
CACHE_LABEL="$3"

if ! [[ "$CACHE_SAVE_MAX_BYTES" =~ ^[1-9][0-9]*$ ]]; then
  echo "::error::max-bytes must be a positive integer, got: '$CACHE_SAVE_MAX_BYTES'"
  exit 1
fi

if [ ! -e "$CACHE_PATH" ]; then
  bytes=0
  echo "bytes=$bytes" >> "$GITHUB_OUTPUT"
  echo "save=false" >> "$GITHUB_OUTPUT"
  echo "::notice::Skipping ${CACHE_LABEL} cache save because ${CACHE_PATH} does not exist."
  exit 0
fi

bytes=$(du -sk "$CACHE_PATH" | awk '{printf "%.0f", $1 * 1024}')
echo "bytes=$bytes" >> "$GITHUB_OUTPUT"
if [ "$bytes" -gt "$CACHE_SAVE_MAX_BYTES" ]; then
  echo "save=false" >> "$GITHUB_OUTPUT"
  echo "::notice::Skipping ${CACHE_LABEL} cache save because ${CACHE_PATH} is ${bytes} bytes (> ${CACHE_SAVE_MAX_BYTES})."
else
  echo "save=true" >> "$GITHUB_OUTPUT"
fi
