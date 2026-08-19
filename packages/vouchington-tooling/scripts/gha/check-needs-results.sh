#!/usr/bin/env bash
set -euo pipefail

label="${1:-required jobs}"
results="${RESULTS:-}"

if [ -z "$results" ]; then
  echo "::error::RESULTS is required"
  exit 1
fi

echo "Job results: $results"

if echo "$results" | grep -qE '"result":\s*"(failure|cancelled)"'; then
  echo "One or more ${label} failed or were cancelled"
  exit 1
fi

echo "All ${label} passed or were skipped"
