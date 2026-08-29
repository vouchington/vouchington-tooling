#!/usr/bin/env bash
set -euo pipefail

if [ "${#}" -ne 1 ]; then
  echo "usage: harness-admission-lane.sh <lanes>" >&2
  exit 2
fi

if [ -z "${GITHUB_OUTPUT:-}" ]; then
  echo 'GITHUB_OUTPUT must be set' >&2
  exit 2
fi

LANES="$1"
if ! [[ "$LANES" =~ ^[1-9][0-9]*$ ]]; then
  echo "::error::admission lane count must be a positive integer, got: '$LANES'"
  exit 1
fi

RUN_ID="${GITHUB_RUN_ID:-}"
if ! [[ "$RUN_ID" =~ ^[0-9]+$ ]]; then
  echo "::error::GITHUB_RUN_ID must be a non-negative integer, got: '${RUN_ID}'"
  exit 1
fi

echo "lane=$(( RUN_ID % LANES ))" >> "$GITHUB_OUTPUT"
