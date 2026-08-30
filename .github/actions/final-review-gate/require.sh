#!/usr/bin/env bash
set -euo pipefail
[ "$GATE_OUTCOME" = success ]
case "$GATE_STATUS" in
  review|untrusted) [ "$MARK_OUTCOME" = success ] ;;
esac
if [ -n "${CHECK_NAME:-}" ]; then
  [ "$CHECK_OUTCOME" = success ]
  [ "$CHECK_CONCLUSION" = success ]
fi
