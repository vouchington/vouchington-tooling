set -euo pipefail
# shellcheck source=gh-retry.sh
source "$(dirname "${BASH_SOURCE[0]}")/gh-retry.sh"
gh_capture_retry none gh api --method GET "repos/$GITHUB_REPOSITORY/pulls/$PR_NUMBER"
pr_json="$GH_RETRY_OUTPUT"
[ "$(jq -r '.head.sha' <<< "$pr_json")" = "$SELECTED_HEAD_SHA" ] || {
  echo '::error::PR head changed before completing labels.'; exit 1;
}
[ "$(jq -r '.base.sha' <<< "$pr_json")" = "$SELECTED_BASE_SHA" ] || {
  echo '::error::PR base changed before completing labels.'; exit 1;
}
[ "$(jq -r '.base.ref' <<< "$pr_json")" = "$DEFAULT_BRANCH" ] || {
  echo '::error::PR no longer targets the default branch before completing labels.'; exit 1;
}
[ "$(jq -r '.base.repo.full_name' <<< "$pr_json")" = "$GITHUB_REPOSITORY" ] || {
  echo '::error::PR base repository changed before completing labels.'; exit 1;
}
[ "$(jq -r '.draft' <<< "$pr_json")" = false ] || {
  echo '::error::PR became a draft before completing labels.'; exit 1;
}
[ "$(jq -r '.state' <<< "$pr_json")" = open ] || {
  echo '::error::PR closed before completing labels.'; exit 1;
}
if [ "$GATE_STATUS" = review ]; then
  gh_capture_retry none gh api --method POST "repos/$GITHUB_REPOSITORY/issues/$PR_NUMBER/labels" \
    -f "labels[]=$COMPLETE_LABEL" --silent
fi
if [ -n "$REQUESTED_LABEL" ]; then
  encoded="$(jq -rn --arg value "$REQUESTED_LABEL" '$value | @uri')"
  gh_capture_retry 404 gh api --method DELETE \
    "repos/$GITHUB_REPOSITORY/issues/$PR_NUMBER/labels/$encoded" --silent
fi
