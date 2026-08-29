set -euo pipefail
pr_json="$(gh api --method GET "repos/$GITHUB_REPOSITORY/pulls/$PR_NUMBER")"
[ "$(jq -r '.head.sha' <<< "$pr_json")" = "$SELECTED_HEAD_SHA" ] || {
  echo '::error::PR head changed before completing labels.'; exit 1;
}
[ "$(jq -r '.base.sha' <<< "$pr_json")" = "$SELECTED_BASE_SHA" ]
[ "$(jq -r '.base.ref' <<< "$pr_json")" = "$DEFAULT_BRANCH" ]
[ "$(jq -r '.base.repo.full_name' <<< "$pr_json")" = "$GITHUB_REPOSITORY" ]
[ "$(jq -r '.draft' <<< "$pr_json")" = false ]
[ "$(jq -r '.state' <<< "$pr_json")" = open ]
gh_retry() {
  local accepted="$1"; shift
  local attempt=1 status stderr_file stderr_output http_status reason marker
  stderr_file="stderr-$$.log"
  while true; do
    status=0; "$@" 2> "$stderr_file" || status=$?
    if [ "$status" -eq 0 ]; then rm -f "$stderr_file"; return 0; fi
    stderr_output="$(cat "$stderr_file")"; rm -f "$stderr_file"; http_status=""
    if [[ "$stderr_output" =~ HTTP\ ([0-9]{3}) ]]; then http_status="${BASH_REMATCH[1]}"; fi
    if [ -n "$http_status" ] && [ "$http_status" = "$accepted" ]; then return 0; fi
    reason=""
    if [ -z "$http_status" ]; then while IFS= read -r marker; do case "$stderr_output" in *"$marker"*) reason=transport;; esac; done <<< "$GH_RETRY_TRANSPORT_MARKERS";
    elif [ "$http_status" = 429 ] || [ "$http_status" -ge 500 ]; then reason="HTTP $http_status"; fi
    if [ -z "$reason" ] || [ "$attempt" -ge "$GH_RETRY_ATTEMPTS" ]; then printf '%s\n' "$stderr_output" >&2; return "$status"; fi
    sleep "$((attempt * GH_RETRY_BACKOFF_SECONDS))"; attempt=$((attempt + 1))
  done
}
gh_retry none gh api --method POST "repos/$GITHUB_REPOSITORY/issues/$PR_NUMBER/labels" \
  -f "labels[]=$COMPLETE_LABEL" --silent
