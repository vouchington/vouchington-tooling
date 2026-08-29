set -euo pipefail
gh_capture_retry() {
  local accepted="$1"; shift
  local attempt=1 status stderr_output http_status reason marker
  local stdout_file="$RUNNER_TEMP/claude-gh-stdout-$$.log"
  local stderr_file="$RUNNER_TEMP/claude-gh-stderr-$$.log"
  while true; do
    status=0; "$@" > "$stdout_file" 2> "$stderr_file" || status=$?
    if [ "$status" -eq 0 ]; then
      GH_RETRY_OUTPUT="$(cat "$stdout_file")"
      rm -f "$stdout_file" "$stderr_file"
      return 0
    fi
    stderr_output="$(cat "$stderr_file")"; http_status=""
    if [[ "$stderr_output" =~ HTTP\ ([0-9]{3}) ]]; then http_status="${BASH_REMATCH[1]}"; fi
    if [ -n "$http_status" ] && [ "$http_status" = "$accepted" ]; then
      GH_RETRY_OUTPUT=''; rm -f "$stdout_file" "$stderr_file"; return 0
    fi
    reason=""
    if [ -z "$http_status" ]; then
      while IFS= read -r marker; do case "$stderr_output" in *"$marker"*) reason=transport;; esac; done <<< "$GH_RETRY_TRANSPORT_MARKERS"
    elif [ "$http_status" = 403 ] || [ "$http_status" = 429 ] || [ "$http_status" -ge 500 ]; then
      reason="HTTP $http_status"
    fi
    if [ -z "$reason" ] || [ "$attempt" -ge "$GH_RETRY_ATTEMPTS" ]; then
      rm -f "$stdout_file" "$stderr_file"; printf '%s\n' "$stderr_output" >&2; return "$status"
    fi
    echo "::warning::GitHub API $reason; retrying attempt $((attempt + 1))/$GH_RETRY_ATTEMPTS."
    rm -f "$stdout_file" "$stderr_file"
    sleep "$((attempt * GH_RETRY_BACKOFF_SECONDS))"; attempt=$((attempt + 1))
  done
}
gh_capture_retry none gh api --method GET "repos/$GITHUB_REPOSITORY/pulls/$PR_NUMBER"
pr_json="$GH_RETRY_OUTPUT"
current_head="$(jq -r '.head.sha' <<< "$pr_json")"
current_base="$(jq -r '.base.sha' <<< "$pr_json")"
current_base_ref="$(jq -r '.base.ref' <<< "$pr_json")"
current_base_repository="$(jq -r '.base.repo.full_name' <<< "$pr_json")"
current_is_draft="$(jq -r '.draft' <<< "$pr_json")"
current_state="$(jq -r '.state' <<< "$pr_json")"
[ "$current_head" = "$EXPECTED_HEAD_SHA" ] || {
  echo '::error::PR head changed before Claude dispatch.'; exit 1;
}
[ "$current_base" = "$EXPECTED_BASE_SHA" ] || {
  echo '::error::PR base changed before Claude dispatch.'; exit 1;
}
[ "$current_base_ref" = "$DEFAULT_BRANCH" ] || {
  echo '::error::PR no longer targets the default branch before Claude dispatch.'; exit 1;
}
[ "$current_base_repository" = "$GITHUB_REPOSITORY" ] || {
  echo '::error::PR base repository changed before Claude dispatch.'; exit 1;
}
[ "$current_is_draft" = false ] || {
  echo '::error::PR became a draft before Claude dispatch.'; exit 1;
}
[ "$current_state" = open ] || {
  echo '::error::PR closed before Claude dispatch.'; exit 1;
}

body="$RUNNER_TEMP/claude-review-dispatch.json"
jq -n \
  --arg ref "$DEFAULT_BRANCH" \
  --arg pr_number "$PR_NUMBER" \
  --arg expected_head_sha "$EXPECTED_HEAD_SHA" \
  --arg expected_base_sha "$EXPECTED_BASE_SHA" \
  --arg model "$MODEL" \
  --arg effort "$EFFORT" \
  '{ref: $ref, return_run_details: true, inputs: {
    pr_number: $pr_number,
    expected_head_sha: $expected_head_sha,
    expected_base_sha: $expected_base_sha,
    model: $model,
    effort: $effort,
    required_review: "true"
  }}' > "$body"
response="$(gh api --method POST \
  -H 'X-GitHub-Api-Version: 2026-03-10' \
  "repos/$GITHUB_REPOSITORY/actions/workflows/claude-code-review.yml/dispatches" \
  --input "$body")"
run_id="$(jq -r '.workflow_run_id' <<< "$response")"
run_url="$(jq -r '.html_url' <<< "$response")"
[[ "$run_id" =~ ^[0-9]+$ ]] || { echo '::error::Dispatch did not return a workflow_run_id.'; exit 1; }
echo "run_url=$run_url" >> "$GITHUB_OUTPUT"
echo "Trusted Claude review: $run_url" >> "$GITHUB_STEP_SUMMARY"

attempt=1
while [ "$attempt" -le "$WAIT_ATTEMPTS" ]; do
  gh_capture_retry none gh api --method GET \
    "repos/$GITHUB_REPOSITORY/actions/runs/$run_id"
  run_json="$GH_RETRY_OUTPUT"
  status="$(jq -r '.status' <<< "$run_json")"
  if [ "$status" = completed ]; then
    conclusion="$(jq -r '.conclusion // "failure"' <<< "$run_json")"
    echo "conclusion=$conclusion" >> "$GITHUB_OUTPUT"
    [ "$conclusion" = success ] || {
      echo "::error::Trusted Claude review concluded $conclusion: $run_url"
      exit 1
    }
    exit 0
  fi
  sleep "$WAIT_SECONDS"
  attempt=$((attempt + 1))
done
echo 'conclusion=timed_out' >> "$GITHUB_OUTPUT"
echo "::error::Timed out waiting for trusted Claude review: $run_url"
exit 1
