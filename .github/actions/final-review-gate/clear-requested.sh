#!/usr/bin/env bash
set -euo pipefail
# shellcheck source-path=SCRIPTDIR
# shellcheck source=gh-retry.sh
source "$(dirname "${BASH_SOURCE[0]}")/gh-retry.sh"

gh_capture_retry none gh api --method GET "repos/$GITHUB_REPOSITORY/pulls/$PR_NUMBER"
live_head="$(jq -r '.head.sha' <<<"$GH_RETRY_OUTPUT")"
if [ "$live_head" != "$SELECTED_HEAD_SHA" ]; then
  echo 'A newer pull request head owns pending final-review state.'
  exit 0
fi
encoded="$(jq -rn --arg value "$REQUESTED_LABEL" '$value | @uri')"
gh_capture_retry 404 gh api --method DELETE \
  "repos/$GITHUB_REPOSITORY/issues/$PR_NUMBER/labels/$encoded" --silent
