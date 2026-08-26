#!/usr/bin/env bash
set -euo pipefail

case "${TRUSTED_SECRET_CONTEXT:-}" in
  true|false) ;;
  *)
    echo "::error::trusted-secret-context must be exactly true or false" >&2
    exit 1
    ;;
esac
