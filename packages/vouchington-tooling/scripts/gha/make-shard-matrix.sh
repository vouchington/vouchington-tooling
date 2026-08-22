#!/usr/bin/env bash
set -euo pipefail

if [ "${#}" -ne 1 ]; then
  echo "usage: make-shard-matrix.sh <total>" >&2
  exit 2
fi

if [ -z "${GITHUB_OUTPUT:-}" ]; then
  echo 'GITHUB_OUTPUT must be set' >&2
  exit 2
fi

TOTAL="$1"
if ! [[ "$TOTAL" =~ ^[1-9][0-9]*$ ]]; then
  echo "::error::shard total must be a positive integer, got: '$TOTAL'"
  exit 1
fi
i=1
matrix_ids=""
while [ "$i" -le "$TOTAL" ]; do
  if [ -n "$matrix_ids" ]; then
    matrix_ids="${matrix_ids},${i}"
  else
    matrix_ids="$i"
  fi
  i=$((i + 1))
done
echo "total=$TOTAL" >> "$GITHUB_OUTPUT"
echo "matrix=[${matrix_ids}]" >> "$GITHUB_OUTPUT"
