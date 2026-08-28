#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo 'usage: download-optional-run-artifacts.sh (--name <name> | --pattern <pattern>) --dir <directory>' >&2
  exit 2
}

selector=''
selector_type=''
destination=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --name|--pattern)
      [ -z "$selector_type" ] && [ "$#" -ge 2 ] || usage
      selector_type="${1#--}"
      selector="$2"
      shift 2
      ;;
    --dir)
      [ -z "$destination" ] && [ "$#" -ge 2 ] || usage
      destination="$2"
      shift 2
      ;;
    *) usage ;;
  esac
done

[ -n "$selector_type" ] && [ -n "$selector" ] && [ -n "$destination" ] || usage
[ -n "${GITHUB_OUTPUT:-}" ] || { echo 'GITHUB_OUTPUT must be set' >&2; exit 2; }
[ -n "${GITHUB_REPOSITORY:-}" ] || { echo 'GITHUB_REPOSITORY must be set' >&2; exit 2; }
[ -n "${GITHUB_RUN_ID:-}" ] || { echo 'GITHUB_RUN_ID must be set' >&2; exit 2; }

download_exact() {
  artifact="$1"
  directory="$2"
  echo "[optional-run-artifacts] attempt selector=$selector_type" >&2
  gh run download "$GITHUB_RUN_ID" --repo "$GITHUB_REPOSITORY" --name "$artifact" --dir "$directory"
}

download_pattern() {
  artifacts=$(gh api --paginate "repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID/artifacts?per_page=100" --jq '.artifacts[] | select(.expired | not) | .name') || return $?
  count=0
  while IFS= read -r artifact; do
    # shellcheck disable=SC2254
    # selector is the caller's intended glob pattern.
    case "$artifact" in
      $selector) ;;
      *) continue ;;
    esac
    case "$artifact" in
      *[!A-Za-z0-9._-]*) return 2 ;;
    esac
    count=$((count + 1))
    echo "[optional-run-artifacts] selected artifact=$artifact" >&2
  done <<EOF
$artifacts
EOF
  echo "[optional-run-artifacts] selection selector=pattern count=$count" >&2
  [ "$count" -gt 0 ] || return 1
  while IFS= read -r artifact; do
    # shellcheck disable=SC2254
    case "$artifact" in
      $selector) ;;
      *) continue ;;
    esac
    echo "[optional-run-artifacts] attempt artifact=$artifact" >&2
    gh run download "$GITHUB_RUN_ID" --repo "$GITHUB_REPOSITORY" --name "$artifact" --dir "$destination/$artifact" || return $?
  done <<EOF
$artifacts
EOF
}

if [ "$selector_type" = name ]; then
  if download_exact "$selector" "$destination"; then status=0; else status=$?; fi
else
  if download_pattern; then status=0; else status=$?; fi
fi
if [ "$status" -eq 0 ]; then
  echo 'availability=available' >> "$GITHUB_OUTPUT"
  echo "[optional-run-artifacts] result=available selector=$selector_type" >&2
else
  case "$status" in
    130|143) exit "$status" ;;
  esac
  echo 'availability=unavailable' >> "$GITHUB_OUTPUT"
  echo "::warning::Optional same-run artifact unavailable; continuing with validated fallback (selector=$selector_type exit=$status)" >&2
  echo "[optional-run-artifacts] result=unavailable selector=$selector_type exit=$status" >&2
fi
