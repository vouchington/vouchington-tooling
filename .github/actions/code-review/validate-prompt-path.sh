#!/usr/bin/env bash
# Validate a caller-supplied relative path inside a trusted checkout.
set -euo pipefail
path="${1:-}"
if [ -z "$path" ]; then
  echo "::error::Prompt path must be a non-empty relative path."
  exit 1
fi
if [[ "$path" == /* || "$path" == ~* || "$path" == *..* || "$path" == *$'\n'* || "$path" == *$'\r'* ]]; then
  echo "::error::Prompt path must be a relative path without .. or newlines."
  exit 1
fi
printf '%s\n' "$path"
