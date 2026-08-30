#!/usr/bin/env bash
set -euo pipefail

output() { printf '%s=%s\n' "$1" "$2" >>"${GITHUB_OUTPUT:?}"; }
stop() { output requested false; output decision "$1"; echo "$2"; exit 0; }
positive() { [[ "$1" =~ ^[1-9][0-9]*$ ]]; }
nonnegative() { [[ "$1" =~ ^[0-9]+$ ]]; }
workflow_path() { [[ "$1" == .github/workflows/*.yml || "$1" == .github/workflows/*.yaml ]]; }

[[ "${TESTED_HEAD_SHA:?}" =~ ^[0-9a-f]{40}$ ]] || { echo '::error::source-head-sha must be a full lowercase commit SHA.'; exit 1; }
if ! positive "${SOURCE_RUN_ID:?}" || ! positive "${RETRY_ATTEMPTS:?}" || ! nonnegative "${RETRY_BACKOFF_SECONDS:?}"; then
  echo '::error::Invalid source run or retry configuration.'; exit 1
fi
if ! workflow_path "${SOURCE_WORKFLOW_PATH:?}" || ! workflow_path "${REVIEW_WORKFLOW_PATH:?}"; then
  echo '::error::Workflow paths must be under .github/workflows.'; exit 1
fi
[ -n "${READ_TOKEN:?}" ] && [ -n "${WRITE_TOKEN:?}" ] && [ -n "${FAN_IN_JOB:?}" ] && \
  [ -n "${REQUESTED_LABEL:?}" ] && [ -n "${REVIEW_CHECK_NAME:?}" ] && [ -n "${DISPATCH_EVENT_TYPE:?}" ] || {
  echo '::error::Required token or final-review identity is missing.'; exit 1
}

gh_retry() {
  local accepted="$1" attempt=1 status captured error_output stdout_file stderr_file
  shift
  stdout_file="$(mktemp "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/gha-retry-stdout.XXXXXX")"
  stderr_file="$(mktemp "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/gha-retry-stderr.XXXXXX")"
  while true; do
    status=0; "$@" >"$stdout_file" 2>"$stderr_file" || status=$?
    captured="$(cat "$stdout_file")"; error_output="$(cat "$stderr_file")"
    if [ "$status" -eq 0 ]; then
      GH_OUTPUT="$captured"; [ -z "$error_output" ] || printf '%s\n' "$error_output" >&2
      rm -f "$stdout_file" "$stderr_file"; return 0
    fi
    if [ "$accepted" != none ] && grep -q "HTTP $accepted" <<<"$error_output"; then
      GH_OUTPUT=''; rm -f "$stdout_file" "$stderr_file"; return 0
    fi
    if [ "$attempt" -ge "$RETRY_ATTEMPTS" ] || ! grep -Eq \
      'HTTP (403|429|5[0-9]{2})|TLS handshake timeout|timeout awaiting response headers|connection reset by peer|unexpected EOF|i/o timeout' <<<"$error_output"; then
      rm -f "$stdout_file" "$stderr_file"; printf '%s\n' "$error_output" >&2; return "$status"
    fi
    echo "::warning::GitHub API request failed; retrying attempt $((attempt + 1))/$RETRY_ATTEMPTS."
    sleep "$((attempt * RETRY_BACKOFF_SECONDS))"; attempt=$((attempt + 1))
  done
}
export GH_TOKEN="$READ_TOKEN"
mutate() { GH_TOKEN="$WRITE_TOKEN" gh_retry "$@"; }

gh_retry none gh api "repos/$GITHUB_REPOSITORY/actions/runs/$SOURCE_RUN_ID"
source_run="$GH_OUTPUT"
source_attempt="$(jq -r '.run_attempt' <<<"$source_run")"
jq -e --arg path "$SOURCE_WORKFLOW_PATH" --arg event "$SOURCE_WORKFLOW_EVENT" --arg sha "$TESTED_HEAD_SHA" \
  --arg head_repo "$SOURCE_HEAD_REPOSITORY" \
  '.path == $path and .event == $event and .head_sha == $sha and .head_repository.full_name == $head_repo and .status == "completed"' \
  >/dev/null <<<"$source_run" || {
  echo '::error::Source workflow identity, event, head, or completion state did not match.'; exit 1
}

if [ -z "$PR_NUMBER" ]; then
  gh_retry none gh api --method GET "repos/$GITHUB_REPOSITORY/commits/$TESTED_HEAD_SHA/pulls" \
    -f per_page=100 --paginate --slurp
  matches="$(jq -c --arg sha "$TESTED_HEAD_SHA" --arg repo "$GITHUB_REPOSITORY" --arg base "$DEFAULT_BRANCH" --arg head_repo "$SOURCE_HEAD_REPOSITORY" \
    '[.[][] | select(.state == "open" and .head.sha == $sha and .head.repo.full_name == $head_repo and .base.repo.full_name == $repo and .base.ref == $base)]' <<<"$GH_OUTPUT")"
  [ "$(jq 'length' <<<"$matches")" -eq 1 ] || { echo '::error::Could not resolve exactly one open pull request for the source head.'; exit 1; }
  PR_NUMBER="$(jq -r '.[0].number' <<<"$matches")"
fi
[[ "$PR_NUMBER" =~ ^[1-9][0-9]*$ ]] || { echo '::error::pr-number must be positive.'; exit 1; }
output pr_number "$PR_NUMBER"

gh_retry none gh api "repos/$GITHUB_REPOSITORY/pulls/$PR_NUMBER"
pr_json="$GH_OUTPUT"
[ "$(jq -r '.state' <<<"$pr_json")" = open ] || stop closed 'Pull request is no longer open.'
[ "$(jq -r '.head.sha' <<<"$pr_json")" = "$TESTED_HEAD_SHA" ] || stop stale 'Source result is stale for the current pull request head.'
base_sha="$(jq -r '.base.sha' <<<"$pr_json")"
[[ "$base_sha" =~ ^[0-9a-f]{40}$ ]] || { echo '::error::Pull request base must be a full lowercase commit SHA.'; exit 1; }
jq -e --argjson pr "$PR_NUMBER" --arg base "$base_sha" \
  'any(.pull_requests[]?; .number == $pr and .base.sha == $base)' >/dev/null <<<"$source_run" || \
  stop stale 'Source workflow is not bound to the current pull request base.'
if [ "$(jq -r '.draft' <<<"$pr_json")" != false ]; then
  for label in "$REQUESTED_LABEL" "$COMPLETE_LABEL"; do
    [ -z "$label" ] || mutate 404 gh api --method DELETE "repos/$GITHUB_REPOSITORY/issues/$PR_NUMBER/labels/$(jq -rn --arg value "$label" '$value | @uri')" --silent
  done
  stop draft 'Pull request is a draft; final-review labels were cleared.'
fi

gh_retry none gh api --method GET "repos/$GITHUB_REPOSITORY/actions/runs/$SOURCE_RUN_ID/jobs" \
  -f filter=all -f per_page=100 --paginate --slurp
jobs="$GH_OUTPUT"
jq -e --arg job "$FAN_IN_JOB" --argjson attempt "$source_attempt" \
  '([.[].jobs[] | select(.run_attempt == $attempt and .name == $job)] | sort_by(.id) | last | .conclusion) == "success"' \
  >/dev/null <<<"$jobs" || stop ineligible "Source fan-in $FAN_IN_JOB did not pass."
if [ -n "$FORBIDDEN_SUCCESS_JOB" ] && jq -e --arg job "$FORBIDDEN_SUCCESS_JOB" --argjson attempt "$source_attempt" \
  'any(.[].jobs[]; .run_attempt == $attempt and .name == $job and .conclusion == "success")' >/dev/null <<<"$jobs"; then
  stop ineligible "Forbidden source job $FORBIDDEN_SUCCESS_JOB succeeded."
fi

gh_retry none gh api --method GET "repos/$GITHUB_REPOSITORY/commits/$TESTED_HEAD_SHA/check-runs" \
  -f filter=latest -f per_page=100 --paginate --slurp
review_state=missing
while IFS=$'\t' read -r status conclusion run_id; do
  [ -n "$run_id" ] || continue
  gh_retry none gh api "repos/$GITHUB_REPOSITORY/actions/runs/$run_id"
  jq -e --arg path "$REVIEW_WORKFLOW_PATH" --arg event "$REVIEW_WORKFLOW_EVENT" \
    '.path == $path and .event == $event' >/dev/null <<<"$GH_OUTPUT" || continue
  [ "$status" = completed ] && review_state="$conclusion" || review_state=active
  break
done < <(jq -r --arg name "$REVIEW_CHECK_NAME" \
  '[.[].check_runs[] | select(.name == $name and .app.slug == "github-actions")] | sort_by(.id) | reverse[] |
  [.status, (.conclusion // "none"), (try (.details_url | capture("/actions/runs/(?<id>[0-9]+)/").id) catch "")] | @tsv' <<<"$GH_OUTPUT")
case "$review_state" in active|success) stop duplicate "Skipping duplicate final review ($review_state)." ;; esac

for label in "$COMPLETE_LABEL" "$REQUESTED_LABEL"; do
  [ -z "$label" ] || mutate 404 gh api --method DELETE "repos/$GITHUB_REPOSITORY/issues/$PR_NUMBER/labels/$(jq -rn --arg value "$label" '$value | @uri')" --silent
done
gh_retry none gh api "repos/$GITHUB_REPOSITORY/pulls/$PR_NUMBER"
final_state="$GH_OUTPUT"
[ "$(jq -r '.state' <<<"$final_state")" = open ] || stop closed 'Pull request closed before label creation.'
[ "$(jq -r '.draft' <<<"$final_state")" = false ] || stop draft 'Pull request became a draft before label creation.'
[ "$(jq -r '.head.sha' <<<"$final_state")" = "$TESTED_HEAD_SHA" ] || stop stale 'Pull request head changed before label creation.'
[ "$(jq -r '.base.sha' <<<"$final_state")" = "$base_sha" ] || stop stale 'Pull request base changed before dispatch.'
mutate none gh api --method POST "repos/$GITHUB_REPOSITORY/issues/$PR_NUMBER/labels" -f "labels[]=$REQUESTED_LABEL" --silent
mutate none gh api --method POST "repos/$GITHUB_REPOSITORY/dispatches" \
  -f "event_type=$DISPATCH_EVENT_TYPE" -F "client_payload[pr_number]=$PR_NUMBER" \
  -f "client_payload[head_sha]=$TESTED_HEAD_SHA" -f "client_payload[base_sha]=$base_sha" \
  -F "client_payload[source_run_id]=$SOURCE_RUN_ID" -F "client_payload[source_run_attempt]=$source_attempt"
output requested true; output decision requested
echo "Requested final review for PR #$PR_NUMBER at $TESTED_HEAD_SHA from run $SOURCE_RUN_ID attempt $source_attempt."
