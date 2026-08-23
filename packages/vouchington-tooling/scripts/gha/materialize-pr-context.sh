#!/usr/bin/env bash
# Materialize PR title, body, files, diff, comments, and linked issue/PR
# threads so a review agent does not need gh or bash.
set -euo pipefail

PR_NUMBER="${PR_NUMBER:?PR_NUMBER is required}"
GITHUB_REPOSITORY="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
GITHUB_WORKSPACE="${GITHUB_WORKSPACE:?GITHUB_WORKSPACE is required}"
MAX_MATERIALIZED="${MAX_MATERIALIZED:-20}"
MAX_SEEN="${MAX_SEEN:-40}"

case "$MAX_MATERIALIZED" in
  *[!0-9]* | '')
    echo "materialize-pr-context: MAX_MATERIALIZED must be a non-negative integer" >&2
    exit 2
    ;;
esac
case "$MAX_SEEN" in
  *[!0-9]* | '')
    echo "materialize-pr-context: MAX_SEEN must be a non-negative integer" >&2
    exit 2
    ;;
esac

review_context="${REVIEW_CONTEXT_DIR:-${GITHUB_WORKSPACE}/.review-context}"
rm -rf "$review_context"
mkdir -p "$review_context/issues"

extract_issue_numbers() {
  grep -oE "(https://github.com/${GITHUB_REPOSITORY}/(issues|pull)/[0-9]+|#[0-9]+)" |
    grep -oE '[0-9]+' ||
    true
}

enqueue_from_text() {
  local seen_file="$1"
  local queue_file="$2"
  local materialized_file="$3"
  local number
  while IFS= read -r number; do
    [ -n "$number" ] || continue
    [ "$number" = "$PR_NUMBER" ] && continue
    grep -qxF "$number" "$seen_file" && continue
    if [ "$(wc -l <"$materialized_file" | tr -d ' ')" -ge "$MAX_MATERIALIZED" ]; then
      return 0
    fi
    if [ "$(wc -l <"$seen_file" | tr -d ' ')" -ge "$MAX_SEEN" ]; then
      return 0
    fi
    printf '%s\n' "$number" >>"$seen_file"
    printf '%s\n' "$number" >>"$queue_file"
  done
}

gh pr view "$PR_NUMBER" --repo "$GITHUB_REPOSITORY" \
  --json title,body,url,author,baseRefName,headRefName,headRefOid \
  >"$review_context/pr.json"
gh api --paginate --slurp "repos/${GITHUB_REPOSITORY}/pulls/${PR_NUMBER}/files?per_page=100" |
  jq 'add // []' >"$review_context/files.json"
if ! gh pr diff "$PR_NUMBER" --repo "$GITHUB_REPOSITORY" >"$review_context/pr.diff"; then
  printf 'PR diff unavailable (GitHub limits patch responses to 300 files). Use files.json.\n' \
    >"$review_context/pr.diff"
fi
gh api --paginate --slurp "repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments?per_page=100" |
  jq 'add // []' >"$review_context/pr-comments.json"
gh api --paginate --slurp "repos/${GITHUB_REPOSITORY}/pulls/${PR_NUMBER}/comments?per_page=100" |
  jq 'add // []' >"$review_context/pr-review-comments.json"
gh api --paginate --slurp "repos/${GITHUB_REPOSITORY}/pulls/${PR_NUMBER}/reviews?per_page=100" |
  jq 'add // []' >"$review_context/pr-reviews.json"

seen_file="${review_context}/.seen"
queue_file="${review_context}/.queue"
materialized_file="${review_context}/.materialized"
: >"$seen_file"
: >"$queue_file"
: >"$materialized_file"

{
  jq -r '.body // ""' "$review_context/pr.json"
  jq -r '.[].body // ""' "$review_context/pr-comments.json"
  jq -r '.[].body // ""' "$review_context/pr-review-comments.json"
  jq -r '.[].body // ""' "$review_context/pr-reviews.json"
} | extract_issue_numbers | enqueue_from_text "$seen_file" "$queue_file" "$materialized_file"

index=1
while true; do
  if [ "$(wc -l <"$materialized_file" | tr -d ' ')" -ge "$MAX_MATERIALIZED" ]; then
    break
  fi
  issue_number="$(sed -n "${index}p" "$queue_file")"
  [ -n "$issue_number" ] || break
  index=$((index + 1))
  if ! gh api "repos/${GITHUB_REPOSITORY}/issues/${issue_number}" \
    --jq '{number,title,body,url,pull_request}' \
    >"$review_context/issues/${issue_number}.json"; then
    rm -f "$review_context/issues/${issue_number}.json"
    continue
  fi
  printf '%s\n' "$issue_number" >>"$materialized_file"
  gh api --paginate --slurp \
    "repos/${GITHUB_REPOSITORY}/issues/${issue_number}/comments?per_page=100" |
    jq 'add // []' >"$review_context/issues/${issue_number}-comments.json" ||
    printf '[]\n' >"$review_context/issues/${issue_number}-comments.json"
  {
    jq -r '.body // ""' "$review_context/issues/${issue_number}.json"
    jq -r '.[].body // ""' "$review_context/issues/${issue_number}-comments.json"
    if jq -e '.pull_request != null' "$review_context/issues/${issue_number}.json" >/dev/null; then
      gh api --paginate --slurp \
        "repos/${GITHUB_REPOSITORY}/pulls/${issue_number}/comments?per_page=100" |
        jq 'add // []' >"$review_context/issues/${issue_number}-review-comments.json" ||
        printf '[]\n' >"$review_context/issues/${issue_number}-review-comments.json"
      gh api --paginate --slurp \
        "repos/${GITHUB_REPOSITORY}/pulls/${issue_number}/reviews?per_page=100" |
        jq 'add // []' >"$review_context/issues/${issue_number}-reviews.json" ||
        printf '[]\n' >"$review_context/issues/${issue_number}-reviews.json"
      jq -r '.[].body // ""' "$review_context/issues/${issue_number}-review-comments.json"
      jq -r '.[].body // ""' "$review_context/issues/${issue_number}-reviews.json"
    fi
  } | extract_issue_numbers | enqueue_from_text "$seen_file" "$queue_file" "$materialized_file"
done

rm -f "$seen_file" "$queue_file" "$materialized_file"
printf 'Materialized PR #%s context in %s\n' "$PR_NUMBER" "$review_context"
