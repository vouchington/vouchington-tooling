#!/usr/bin/env bash
set -euo pipefail
# shellcheck source-path=SCRIPTDIR
# shellcheck source=gh-retry.sh
source "$(dirname "${BASH_SOURCE[0]}")/gh-retry.sh"
conclusion=failure
if [ "$GATE_OUTCOME" = success ] && \
  { [ -z "$REQUESTED_LABEL" ] || [ "$CLEANUP_OUTCOME" = success ]; }; then
  case "$GATE_STATUS" in
    untrusted) if [ "$MARK_OUTCOME" = success ]; then conclusion=success; fi ;;
    review) if [ "$MARK_OUTCOME" = success ]; then conclusion=success; fi ;;
  esac
fi
details_url="$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"
gh_capture_retry none gh api --method POST "repos/$GITHUB_REPOSITORY/check-runs" \
  -f "name=$CHECK_NAME" -f "head_sha=$SELECTED_HEAD_SHA" -f status=completed \
  -f "conclusion=$conclusion" -f "details_url=$details_url" --silent
printf 'conclusion=%s\n' "$conclusion" >>"$GITHUB_OUTPUT"
