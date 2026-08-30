set -euo pipefail
output() { printf '%s=%s\n' "$1" "$2" >> "$GITHUB_OUTPUT"; }
gh_capture_retry() {
  local accepted="$1"; shift
  local attempt=1 status stdout_file stderr_file stderr_output http_status reason marker
  stdout_file="stdout-$$.log"; stderr_file="stderr-$$.log"
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
output pr_number "$PR_NUMBER"

case "$EVENT_NAME" in
  pull_request|pull_request_target) ;;
  *)
    echo '::error::Final Code Review requires a pull_request or pull_request_target event.'
    exit 1
    ;;
esac

gh_capture_retry none gh api --method GET "repos/$GITHUB_REPOSITORY/pulls/$PR_NUMBER"
pr_json="$GH_RETRY_OUTPUT"
head_sha="$(jq -r '.head.sha' <<< "$pr_json")"
head_repository="$(jq -r '.head.repo.full_name' <<< "$pr_json")"
head_ref="$(jq -r '.head.ref' <<< "$pr_json")"
base_sha="$(jq -r '.base.sha' <<< "$pr_json")"
base_ref="$(jq -r '.base.ref' <<< "$pr_json")"
base_repository="$(jq -r '.base.repo.full_name' <<< "$pr_json")"
is_draft="$(jq -r '.draft' <<< "$pr_json")"
state="$(jq -r '.state' <<< "$pr_json")"
is_cross_repository="$(jq -r '.head.repo.full_name != .base.repo.full_name' <<< "$pr_json")"
actor="$(jq -r '.user.login' <<< "$pr_json")"
has_complete="$(jq -r --arg label "$COMPLETE_LABEL" 'any(.labels[]?.name; . == $label)' <<< "$pr_json")"
if [[ ! "$head_sha" =~ ^[0-9a-f]{40}$ ]] || [[ ! "$base_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo '::error::PR head and base refs must resolve to full commit SHAs.'
  exit 1
fi
output head_sha "$head_sha"
output base_sha "$base_sha"

if [ "$base_ref" != "$DEFAULT_BRANCH" ] || \
  [ "$base_repository" != "$GITHUB_REPOSITORY" ]; then
  output should_review false
  output gate_status ignore
  echo "Final code review is unavailable for base branch $base_ref."
  exit 0
fi

is_untrusted=false
if [ "$is_cross_repository" = true ] || [ "$actor" = dependabot ] || \
  [ "$actor" = 'dependabot[bot]' ] || [ "$actor" = 'app/dependabot' ] || \
  [ "$actor" = renovate ] || [ "$actor" = 'renovate[bot]' ] || \
  [ "$actor" = 'app/renovate' ]; then
  is_untrusted=true
fi
if [ -n "$EVENT_HEAD_SHA" ] && [ "$EVENT_HEAD_SHA" != "$head_sha" ]; then
  output should_review false
  output gate_status stale
  echo "::error::Event head $EVENT_HEAD_SHA no longer matches PR head $head_sha."
  exit 0
fi
if [ "$is_untrusted" != true ] && [ "$has_complete" = true ]; then
  encoded="$(jq -rn --arg value "$COMPLETE_LABEL" '$value | @uri')"
  gh_capture_retry 404 gh api --method DELETE \
    "repos/$GITHUB_REPOSITORY/issues/$PR_NUMBER/labels/$encoded" --silent
  gh_capture_retry none gh api --method GET \
    "repos/$GITHUB_REPOSITORY/pulls/$PR_NUMBER" --jq .head.sha
  current="$GH_RETRY_OUTPUT"
  [ "$current" = "$head_sha" ] || {
    output should_review false
    output gate_status stale
    echo '::error::PR head changed while clearing stale completion state.'
    exit 0
  }
fi
if [ "$state" != open ]; then
  output should_review false
  output gate_status closed
  echo 'Final code review stopped because the PR is closed.'
  exit 0
fi
if [ "$is_draft" = true ]; then
  output should_review false
  output gate_status deferred
  echo 'Final code review is deferred while the PR is a draft.'
  exit 0
fi

export head_sha head_repository head_ref base_sha
# shellcheck source=wait-for-tests.sh
source "$(dirname "${BASH_SOURCE[0]}")/wait-for-tests.sh"

gh_capture_retry none gh api --method GET "repos/$GITHUB_REPOSITORY/pulls/$PR_NUMBER"
current_pr_json="$GH_RETRY_OUTPUT"
current="$(jq -r '.head.sha' <<< "$current_pr_json")"
current_base_sha="$(jq -r '.base.sha' <<< "$current_pr_json")"
current_base_ref="$(jq -r '.base.ref' <<< "$current_pr_json")"
current_base_repository="$(jq -r '.base.repo.full_name' <<< "$current_pr_json")"
current_is_draft="$(jq -r '.draft' <<< "$current_pr_json")"
current_state="$(jq -r '.state' <<< "$current_pr_json")"
if [ "$current" != "$head_sha" ] || [ "$current_base_sha" != "$base_sha" ] || \
  [ "$current_base_ref" != "$DEFAULT_BRANCH" ] || \
  [ "$current_base_repository" != "$GITHUB_REPOSITORY" ]; then
  output should_review false
  output gate_status base-stale
  echo '::error::PR head or base changed after tests completed.'
  exit 0
fi
if [ "$current_state" != open ]; then
  output should_review false
  output gate_status closed
  echo 'PR closed after tests completed.'
  exit 0
fi
if [ "$current_is_draft" = true ]; then
  output should_review false
  output gate_status deferred
  echo 'PR became a draft after tests completed.'
  exit 0
fi

if [ "$is_untrusted" = true ]; then
  output should_review false
  output gate_status untrusted
  echo 'Secret-backed review is unavailable for this PR context after exact-head tests passed.'
  exit 0
fi

output should_review true
output gate_status review
echo "Selected PR #$PR_NUMBER at $head_sha for final review."
