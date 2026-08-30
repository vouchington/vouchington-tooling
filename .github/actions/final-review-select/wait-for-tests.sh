tests_passed=false
inspected_runs=''
ci_workflow="${CI_WORKFLOW:-ci.yml}"
tests_job="${TESTS_JOB_NAME:-tests}"
gh_capture_retry none gh api --method GET \
  "repos/$GITHUB_REPOSITORY/commits/$head_sha/pulls"
exact_open_prs="$(jq -c --arg sha "$head_sha" --arg head_repo "$head_repository" --argjson pr "$PR_NUMBER" \
  '[.[] | select(.state == "open" and .head.sha == $sha and .head.repo.full_name == $head_repo)]' \
  <<< "$GH_RETRY_OUTPUT")"
empty_association_allowed=false
if [ "$(jq 'length' <<< "$exact_open_prs")" -eq 1 ] && \
  [ "$(jq -r '.[0].number' <<< "$exact_open_prs")" -eq "$PR_NUMBER" ]; then
  empty_association_allowed=true
fi
attempt=1
while [ "$attempt" -le "$TESTS_WAIT_ATTEMPTS" ]; do
  if ! gh_capture_retry none gh api --method GET \
    "repos/$GITHUB_REPOSITORY/pulls/$PR_NUMBER"; then
    echo '::warning::Could not refresh the PR head; retrying.'
    sleep "$TESTS_WAIT_SECONDS"
    attempt=$((attempt + 1))
    continue
  fi
  current_pr_json="$GH_RETRY_OUTPUT"
  current="$(jq -r '.head.sha' <<< "$current_pr_json")"
  current_base_sha="$(jq -r '.base.sha' <<< "$current_pr_json")"
  current_base_ref="$(jq -r '.base.ref' <<< "$current_pr_json")"
  current_base_repository="$(jq -r '.base.repo.full_name' <<< "$current_pr_json")"
  current_is_draft="$(jq -r '.draft' <<< "$current_pr_json")"
  current_state="$(jq -r '.state' <<< "$current_pr_json")"
  if [ "$current" != "$head_sha" ]; then
    output should_review false
    output gate_status stale
    echo "::error::PR head changed from $head_sha to $current while waiting for tests."
    exit 0
  fi
  if [ "$current_state" != open ]; then
    output should_review false
    output gate_status closed
    echo 'PR closed while waiting for tests.'
    exit 0
  fi
  if [ "$current_base_sha" != "$base_sha" ] || \
    [ "$current_base_ref" != "$DEFAULT_BRANCH" ] || \
    [ "$current_base_repository" != "$GITHUB_REPOSITORY" ]; then
    output should_review false
    output gate_status base-stale
    echo '::error::PR base changed while waiting for tests.'
    exit 0
  fi
  if [ "$current_is_draft" = true ]; then
    output should_review false
    output gate_status deferred
    echo 'PR became a draft while waiting for tests.'
    exit 0
  fi
  if gh_capture_retry none gh api --method GET \
    "repos/$GITHUB_REPOSITORY/actions/workflows/$ci_workflow/runs" \
    -f "head_sha=$head_sha" -f event=pull_request -f per_page=20; then
    runs_json="$GH_RETRY_OUTPUT"
    while IFS=: read -r run_id run_attempt run_status; do
      [ -n "$run_id" ] || continue
      run_key="$run_id:$run_attempt"
      case "$inspected_runs" in
        *"|$run_key|"*) continue ;;
      esac
      if ! gh_capture_retry none gh run view "$run_id" \
        --repo "$GITHUB_REPOSITORY" --json jobs; then
        echo "::warning::Could not inspect CI run $run_id attempt $run_attempt; retrying."
        continue
      fi
      if [ -n "${FORBIDDEN_SUCCESS_JOB:-}" ]; then
        jobs_match="$(jq --arg tests "$tests_job" --arg forbidden "$FORBIDDEN_SUCCESS_JOB" \
          '([.jobs[] | select(.name == $tests and .conclusion == "success")] | length) > 0 and
           ([.jobs[] | select(.name == $forbidden and .conclusion == "success")] | length) == 0' \
          <<< "$GH_RETRY_OUTPUT")"
      else
        jobs_match="$(jq --arg tests "$tests_job" \
          '([.jobs[] | select(.name == $tests and .conclusion == "success")] | length) > 0' \
          <<< "$GH_RETRY_OUTPUT")"
      fi
      if [ "$jobs_match" = true ]; then
        tests_passed=true
        break
      fi
      if [ "$run_status" = completed ]; then
        inspected_runs="${inspected_runs}|${run_key}|"
      fi
    done < <(jq -r --argjson pr "$PR_NUMBER" --arg head_repo "$head_repository" --arg head_ref "$head_ref" --arg action "$EVENT_ACTION" --arg ready_at "$READY_AT" --argjson empty_ok "$empty_association_allowed" \
      '.workflow_runs[] | select(
        (any(.pull_requests[]?; .number == $pr) or
         ($empty_ok and (.pull_requests | length) == 0 and .head_repository.full_name == $head_repo and .head_branch == $head_ref)) and
        (($action != "opened" and $action != "ready_for_review" and $action != "reopened") or
         .created_at >= $ready_at)) |
        "\(.id):\(.run_attempt):\(.status)"' <<< "$runs_json")
  else
    echo '::warning::Could not list exact-head CI runs; retrying.'
  fi
  [ "$tests_passed" = true ] && break
  sleep "$TESTS_WAIT_SECONDS"
  attempt=$((attempt + 1))
done
if [ "$tests_passed" != true ]; then
  output should_review false
  output gate_status untested
  echo "::error::No successful tests fan-in arrived for PR head $head_sha."
  exit 0
fi
