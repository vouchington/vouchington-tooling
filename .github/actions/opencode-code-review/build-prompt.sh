#!/usr/bin/env bash
# Assemble a file-only OpenCode review prompt from a trusted checkout.
set -euo pipefail
if [ -n "${EXTRA_PROMPT:-}" ] && [ "${REPO_PRIVATE:-}" != 'true' ]; then
  echo '::error::extra_prompt is only allowed in private repositories.'
  exit 1
fi
prompt_rel="$(bash "${GITHUB_ACTION_PATH:?}/../code-review/validate-prompt-path.sh" "${PROMPT_PATH:?}")"
inline_rel="$(bash "$GITHUB_ACTION_PATH/../code-review/validate-prompt-path.sh" "${INLINE_PROMPT_PATH:?}")"
trusted_root="${RUNNER_TEMP:?}/trusted-review-prompt"
trusted_prompt="$trusted_root/$prompt_rel"
trusted_inline_prompt="$trusted_root/$inline_rel"
prompt_file="${RUNNER_TEMP}/opencode-review-prompt.md"
if [ ! -f "$trusted_prompt" ]; then
  echo '::notice::Trusted review prompt is not present on the trusted ref; skipping code review.'
  echo 'available=false' >> "${GITHUB_OUTPUT:?}"
  rm -rf "$trusted_root"
  exit 0
fi
if [ ! -f "$trusted_inline_prompt" ]; then
  echo '::notice::Inline comment overlay prompt is not present on the trusted ref; skipping code review.'
  echo 'available=false' >> "$GITHUB_OUTPUT"
  rm -rf "$trusted_root"
  exit 0
fi
{
  printf 'Target: %s\n\n' "${REVIEW_TARGET:?}"
  cat "$trusted_prompt"
  echo
  cat "$trusted_inline_prompt"
  if [ -n "${EXTRA_PROMPT:-}" ]; then
    printf '\n%s\n' "$EXTRA_PROMPT"
  fi
  echo
  echo "Materialized PR context is in ${GITHUB_WORKSPACE:?}/.review-context/ (pr.json, files.json, pr.diff, prompt.md, pr-comments.json, pr-review-comments.json, pr-reviews.json, issues/)."
  echo 'OpenCode cannot use the Agent or Task tool. Perform the entire review in this session; do not delegate.'
  echo "Do not call gh, bash, curl, or webfetch. Write findings to ${GITHUB_WORKSPACE}/code-review-payload.json."
} >"$prompt_file"
{
  echo 'available=true'
  echo "prompt_path=$prompt_file"
} >> "$GITHUB_OUTPUT"
rm -rf "$trusted_root"
