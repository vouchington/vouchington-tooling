legacy_provider_results() {
  local results='[]'
  append_result() {
    results="$(jq -c --arg name "$1" --arg outcome "$2" '. + [{ name: $name, outcome: $outcome }]' <<< "$results")"
  }
  legacy_opencode_outcome() {
    if [ "$1" != success ] || [ "$2" != success ]; then
      printf failure
    elif [ -n "$3" ] && [ "$4" != success ]; then
      printf failure
    else
      printf success
    fi
  }

  if [ "${CLAUDE_ENABLED:-false}" = true ]; then
    append_result Claude "${CLAUDE_RESULT:-}"
  fi
  if [ "${OPENROUTER_ENABLED:-false}" = true ]; then
    append_result 'OpenCode OpenRouter' "$(legacy_opencode_outcome "${OPENROUTER_ACTION:-}" "${OPENROUTER_AGENT:-}" "${OPENROUTER_ARTIFACT:-}" "${OPENROUTER_POSTER:-}")"
  fi
  if [ "${ZEN_ENABLED:-false}" = true ]; then
    append_result 'OpenCode Zen' "$(legacy_opencode_outcome "${ZEN_ACTION:-}" "${ZEN_AGENT:-}" "${ZEN_ARTIFACT:-}" "${ZEN_POSTER:-}")"
  fi
  printf '%s\n' "$results"
}
