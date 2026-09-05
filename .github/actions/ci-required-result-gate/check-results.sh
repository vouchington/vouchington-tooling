#!/usr/bin/env bash
set -euo pipefail

if [ -z "${RESULTS:-}" ]; then
  echo "::error::RESULTS is required"
  exit 1
fi

case "${MODE:-required}" in
  required) label='required jobs' ;;
  build) label='build jobs' ;;
  *)
    echo "::error::Unknown required-result gate mode: ${MODE:-}" >&2
    exit 2
    ;;
esac

if ! jq -e '
  type == "object" and
  length > 0 and
  all(.[]; type == "object" and keys == ["result"] and (.result == "success" or .result == "skipped"))
' <<< "$RESULTS" >/dev/null; then
  echo "One or more ${label} were missing, malformed, or unsuccessful"
  exit 1
fi

echo "All ${label} passed or were skipped"
