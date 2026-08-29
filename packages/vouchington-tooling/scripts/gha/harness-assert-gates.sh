#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: harness-assert-gates.sh <gate>..." >&2
  exit 2
fi

for gate in "$@"; do
  if ! [[ "$gate" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
    echo "::error::invalid gate name: '$gate'"
    exit 1
  fi
done

for gate in "$@"; do
  value="${!gate:-}"
  if [ "$value" = "true" ]; then
    echo "::error::$gate must be disabled but is enabled"
    exit 1
  fi
done

exit 0
