set -euo pipefail
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
pr_json="$(gh api --method GET "repos/$GITHUB_REPOSITORY/pulls/$PR_NUMBER")"
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
    live_draft="$(gh api --method GET "repos/$GITHUB_REPOSITORY/pulls/$PR_NUMBER" --jq .draft)"
    [ "$live_draft" = true ] && { echo 'Final code review stopped because the PR became a draft.'; exit 0; }
    echo '::error::Final code review is unexpectedly deferred'; exit 1 ;;
  untested) echo "::error::Final code review is $GATE_STATUS"; exit 1 ;;
  review) ;;
  *) echo "::error::Unknown final review status: $GATE_STATUS"; exit 1 ;;
esac
provider_failed() {
  [ "$1" = success ] || return 0
  [ "$2" = success ] || return 0
  [ -z "$3" ] && return 1
  [ "$4" = success ] || return 0
  return 1
}
if [ "$CLAUDE_ENABLED" = true ] && [ "$CLAUDE_RESULT" != success ]; then
  echo '::warning::Claude review did not complete successfully.'
fi
if [ "$OPENROUTER_ENABLED" = true ] && provider_failed "$OPENROUTER_ACTION" "$OPENROUTER_AGENT" "$OPENROUTER_ARTIFACT" "$OPENROUTER_POSTER"; then
  echo '::warning::OpenCode OpenRouter review did not complete successfully.'
fi
if [ "$ZEN_ENABLED" = true ] && provider_failed "$ZEN_ACTION" "$ZEN_AGENT" "$ZEN_ARTIFACT" "$ZEN_POSTER"; then
  echo '::warning::OpenCode Zen review did not complete successfully.'
fi
