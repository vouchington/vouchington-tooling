set -euo pipefail
# shellcheck source=gh-retry.sh
source "$(dirname "${BASH_SOURCE[0]}")/gh-retry.sh"
# shellcheck source=legacy-provider-results.sh
source "$(dirname "${BASH_SOURCE[0]}")/legacy-provider-results.sh"
if [ "$IS_DRAFT" = true ]; then exit 0; fi
if [ "$EVENT_STATE" != open ]; then exit 0; fi
if [ "$EVENT_BASE_REF" != "$DEFAULT_BRANCH" ]; then exit 0; fi
[ "$SELECT_RESULT" = success ] || { echo '::error::Review selection failed'; exit 1; }
if [ "$GATE_STATUS" = ignore ]; then
  echo '::error::PR became ineligible during final review selection.'; exit 1;
fi
if [ "$GATE_STATUS" = stale ]; then exit 0; fi
if [ "$GATE_STATUS" = closed ] || [ "$GATE_STATUS" = base-stale ]; then
  echo "::error::Final review selection became $GATE_STATUS."; exit 1;
fi
gh_capture_retry none gh api --method GET "repos/$GITHUB_REPOSITORY/pulls/$PR_NUMBER"
pr_json="$GH_RETRY_OUTPUT"
[ "$(jq -r '.head.sha' <<< "$pr_json")" = "$SELECTED_HEAD_SHA" ] || {
  echo '::error::PR head changed before completion.'; exit 1;
}
[ "$(jq -r '.base.sha' <<< "$pr_json")" = "$SELECTED_BASE_SHA" ] || {
  echo '::error::PR base changed before completion.'; exit 1;
}
[ "$(jq -r '.base.ref' <<< "$pr_json")" = "$DEFAULT_BRANCH" ] || {
  echo '::error::PR no longer targets the default branch before completion.'; exit 1;
}
[ "$(jq -r '.base.repo.full_name' <<< "$pr_json")" = "$GITHUB_REPOSITORY" ] || {
  echo '::error::PR base repository changed before completion.'; exit 1;
}
[ "$(jq -r '.draft' <<< "$pr_json")" = false ] || {
  echo '::error::PR became a draft before completion.'; exit 1;
}
[ "$(jq -r '.state' <<< "$pr_json")" = open ] || {
  echo '::error::PR closed before completion.'; exit 1;
}
if [ "$GATE_STATUS" = untrusted ]; then exit 0; fi
[ "$SETTINGS_RESULT" = success ] || { echo '::error::Review settings are invalid'; exit 1; }
case "$GATE_STATUS" in
  complete) exit 0 ;;
  deferred)
    gh_capture_retry none gh api --method GET "repos/$GITHUB_REPOSITORY/pulls/$PR_NUMBER" --jq .draft
    live_draft="$GH_RETRY_OUTPUT"
    [ "$live_draft" = true ] && { echo 'Final code review stopped because the PR became a draft.'; exit 0; }
    echo '::error::Final code review is unexpectedly deferred'; exit 1 ;;
  untested) echo "::error::Final code review is $GATE_STATUS"; exit 1 ;;
  review) ;;
  *) echo "::error::Unknown final review status: $GATE_STATUS"; exit 1 ;;
esac
provider_results_json="${PROVIDER_RESULTS_JSON:-}"
if [ -z "$provider_results_json" ]; then
  echo '::warning::provider_results_json is required; using deprecated legacy provider environment.'
  provider_results_json="$(legacy_provider_results)"
fi
if ! jq -e '
  type == "array" and
  all(.[]; type == "object" and (keys | sort == ["name", "outcome"]) and
    (.name | type == "string" and length > 0 and (test("[\\r\\n]") | not)) and
    (.outcome | type == "string" and length > 0 and (test("[\\r\\n]") | not)))
' >/dev/null <<< "$provider_results_json"; then
  echo '::error::provider_results_json must be a JSON array of non-empty {name, outcome} strings.'
  exit 1
fi
while IFS= read -r provider_result; do
  provider_name="$(jq -r '.name' <<< "$provider_result")"
  provider_outcome="$(jq -r '.outcome' <<< "$provider_result")"
  if [ "$provider_outcome" != success ]; then
    provider_name="${provider_name//'%'/'%25'}"
    echo "::warning::$provider_name review did not complete successfully."
  fi
done < <(jq -c '.[]' <<< "$provider_results_json")
