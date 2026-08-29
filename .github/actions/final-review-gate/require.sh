set -euo pipefail
[ "$GATE_OUTCOME" = success ]
case "$GATE_STATUS" in
  review) [ "$MARK_OUTCOME" = success ] ;;
esac
