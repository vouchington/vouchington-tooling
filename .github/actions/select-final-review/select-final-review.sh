#!/usr/bin/env bash
set -euo pipefail

output() { printf '%s=%s\n' "$1" "$2" >>"${GITHUB_OUTPUT:?}"; }
stop() { output should_review false; output gate_status "$1"; echo "$2"; exit 0; }
positive() { [[ "$1" =~ ^[1-9][0-9]*$ ]]; }
nonnegative() { [[ "$1" =~ ^[0-9]+$ ]]; }
workflow_path() { [[ "$1" == .github/workflows/*.yml || "$1" == .github/workflows/*.yaml ]]; }

gh_retry() {
  local attempt=1 status captured
  while true; do
    status=0; captured="$("$@" 2>&1)" || status=$?
    if [ "$status" -eq 0 ]; then GH_OUTPUT="$captured"; return 0; fi
    if [ "$attempt" -ge "$RETRY_ATTEMPTS" ] || ! grep -Eq \
      'HTTP (403|429|5[0-9]{2})|TLS handshake timeout|timeout awaiting response headers|connection reset by peer|unexpected EOF|i/o timeout' <<<"$captured"; then
      printf '%s\n' "$captured" >&2; return "$status"
    fi
    echo "::warning::GitHub API request failed; retrying attempt $((attempt + 1))/$RETRY_ATTEMPTS."
    sleep "$((attempt * RETRY_BACKOFF_SECONDS))"; attempt=$((attempt + 1))
  done
}

[ "${EVENT_NAME:?}" = pull_request_target ] || { echo '::error::Selection requires pull_request_target.'; exit 1; }
[[ "${PR_NUMBER:?}" =~ ^[1-9][0-9]*$ ]] || { echo '::error::pr-number must be positive.'; exit 1; }
workflow_path "${WORKFLOW_PATH:?}" || { echo '::error::workflow-path must name a workflow under .github/workflows.'; exit 1; }
if [ -z "${GH_TOKEN:?}" ] || [ -z "${FAN_IN_JOB:?}" ] || [ -z "${REQUESTED_LABEL:?}" ] || \
  ! positive "${RETRY_ATTEMPTS:?}" || ! nonnegative "${RETRY_BACKOFF_SECONDS:?}"; then
  echo '::error::Invalid token, fan-in, label, or retry configuration.'; exit 1
fi

gh_retry gh api "repos/$GITHUB_REPOSITORY/pulls/$PR_NUMBER"
pr_json="$GH_OUTPUT"
head_sha="$(jq -r '.head.sha' <<<"$pr_json")"
head_ref="$(jq -r '.head.ref' <<<"$pr_json")"
head_repository="$(jq -r '.head.repo.full_name' <<<"$pr_json")"
base_sha="$(jq -r '.base.sha' <<<"$pr_json")"
base_ref="$(jq -r '.base.ref' <<<"$pr_json")"
base_repository="$(jq -r '.base.repo.full_name' <<<"$pr_json")"
state="$(jq -r '.state' <<<"$pr_json")"
is_draft="$(jq -r '.draft' <<<"$pr_json")"
is_cross_repository="$(jq -r '.head.repo.full_name != .base.repo.full_name' <<<"$pr_json")"
actor="$(jq -r '.user.login' <<<"$pr_json")"
[[ "$head_sha" =~ ^[0-9a-f]{40}$ && "$base_sha" =~ ^[0-9a-f]{40}$ ]] || {
  echo '::error::PR refs must be full lowercase commit SHAs.'; exit 1
}
output pr_number "$PR_NUMBER"; output head_sha "$head_sha"; output base_sha "$base_sha"
[ "$base_ref" = "$DEFAULT_BRANCH" ] && [ "$base_repository" = "$GITHUB_REPOSITORY" ] || \
  stop ignore 'Final review is unavailable for this base branch.'
[ -z "$EVENT_HEAD_SHA" ] || [ "$EVENT_HEAD_SHA" = "$head_sha" ] || \
  stop stale "::error::Event head $EVENT_HEAD_SHA no longer matches PR head $head_sha."
[ "$state" = open ] || stop closed 'Pull request is closed.'
[ "$is_draft" = false ] || stop deferred 'Final review is deferred while the pull request is a draft.'
case "$EVENT_ACTION" in
  labeled) [ "$EVENT_LABEL" = "$REQUESTED_LABEL" ] || stop ignore 'Ignoring unrelated label event.' ;;
  converted_to_draft) stop deferred 'Final review is deferred after draft conversion.' ;;
  closed) stop closed 'Pull request is closed.' ;;
  *) stop ignore "Ignoring pull request action $EVENT_ACTION." ;;
esac

workflow_file="${WORKFLOW_PATH##*/}"
gh_retry gh api --method GET "repos/$GITHUB_REPOSITORY/actions/workflows/$workflow_file/runs" \
  -f "head_sha=$head_sha" -f "event=$WORKFLOW_EVENT" -f per_page=100
run="$(jq -c --argjson pr "$PR_NUMBER" --arg head "$head_sha" --arg path "$WORKFLOW_PATH" \
  --arg event "$WORKFLOW_EVENT" --arg head_repo "$head_repository" --arg head_ref "$head_ref" '
  [.workflow_runs[] | select(.path == $path and .head_sha == $head and .event == $event and
    .status == "completed" and (any(.pull_requests[]?; .number == $pr) or
    ((.pull_requests | length) == 0 and .head_repository.full_name == $head_repo and
    .head_branch == $head_ref)))] | sort_by(.created_at, .id) | last // empty' <<<"$GH_OUTPUT")"
[ -n "$run" ] || stop untested "::error::No completed validation run exists for $head_sha."
run_id="$(jq -r '.id' <<<"$run")"; run_attempt="$(jq -r '.run_attempt' <<<"$run")"
gh_retry gh api --method GET "repos/$GITHUB_REPOSITORY/actions/runs/$run_id/jobs" \
  -f filter=all -f per_page=100 --paginate --slurp
jobs="$GH_OUTPUT"
jq -e --arg job "$FAN_IN_JOB" --argjson attempt "$run_attempt" \
  '([.[].jobs[] | select(.run_attempt == $attempt and .name == $job)] | sort_by(.id) | last | .conclusion) == "success"' \
  >/dev/null <<<"$jobs" || stop untested "::error::Validation fan-in $FAN_IN_JOB did not pass."
if [ -n "$FORBIDDEN_SUCCESS_JOB" ] && jq -e --arg job "$FORBIDDEN_SUCCESS_JOB" --argjson attempt "$run_attempt" \
  'any(.[].jobs[]; .run_attempt == $attempt and .name == $job and .conclusion == "success")' >/dev/null <<<"$jobs"; then
  stop forbidden "::error::Forbidden job $FORBIDDEN_SUCCESS_JOB succeeded."
fi

gh_retry gh api "repos/$GITHUB_REPOSITORY/pulls/$PR_NUMBER"
current="$GH_OUTPUT"
[ "$(jq -r '.state' <<<"$current")" = open ] || stop closed 'Pull request closed during selection.'
[ "$(jq -r '.draft' <<<"$current")" = false ] || stop deferred 'Pull request became a draft during selection.'
[ "$(jq -r '.head.sha' <<<"$current")" = "$head_sha" ] && \
  [ "$(jq -r '.base.sha' <<<"$current")" = "$base_sha" ] || stop stale 'Pull request refs changed during selection.'
untrusted="$is_cross_repository"
while IFS= read -r candidate; do
  [ -n "$candidate" ] && [ "$candidate" = "$actor" ] && untrusted=true
done <<<"$UNTRUSTED_ACTORS"
[ "$untrusted" = true ] && stop untrusted 'Secret-backed review is unavailable for this pull request context.'
output should_review true; output gate_status review
echo "Selected PR #$PR_NUMBER at $head_sha from completed validation run $run_id attempt $run_attempt."
