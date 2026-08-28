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
github_host="${GH_HOST:-${GITHUB_SERVER_URL:-https://github.com}}"
github_host="${github_host#*://}"
github_host="${github_host%%/*}"
[ -n "$github_host" ] || { echo 'GitHub host must be set' >&2; exit 2; }
repository="$github_host/$GITHUB_REPOSITORY"

validate_artifact_name() {
  case "$1" in
    ''|.|..|*/*|*\\*)
      echo '[optional-run-artifacts] invalid artifact name' >&2
      return 2
      ;;
  esac
}

download_exact() {
  artifact="$1"
  directory="$2"
  validate_artifact_name "$artifact" || return $?
  echo "[optional-run-artifacts] attempt selector=$selector_type" >&2
  gh run download "$GITHUB_RUN_ID" --repo "$repository" --name "$artifact" --dir "$directory"
}

list_artifact_names() {
  gh api \
    --hostname "$github_host" \
    --paginate \
    "repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID/artifacts?per_page=100" \
    --jq '.artifacts[] | select(.expired | not) | .name'
}

download_pattern() {
  artifacts=$(list_artifact_names | awk '!seen[$0]++') || return $?
  count=0
  while IFS= read -r artifact; do
    [ -n "$artifact" ] || continue
    # shellcheck disable=SC2254
    # selector is the caller's intended glob pattern.
    case "$artifact" in
      $selector) ;;
      *) continue ;;
    esac
    validate_artifact_name "$artifact" || return $?
    count=$((count + 1))
    echo "[optional-run-artifacts] selected artifact=$artifact" >&2
  done <<EOF
$artifacts
EOF
  echo "[optional-run-artifacts] selection selector=pattern count=$count" >&2
  [ "$count" -gt 0 ] || return 1
  while IFS= read -r artifact; do
    [ -n "$artifact" ] || continue
    # shellcheck disable=SC2254
    case "$artifact" in
      $selector) ;;
      *) continue ;;
    esac
    validate_artifact_name "$artifact" || return $?
    echo "[optional-run-artifacts] attempt artifact=$artifact" >&2
    gh run download "$GITHUB_RUN_ID" --repo "$repository" --name "$artifact" --dir "$destination/$artifact" || return $?
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
    2)
      echo "[optional-run-artifacts] result=error selector=$selector_type exit=$status" >&2
      exit 2
      ;;
  esac
  echo 'availability=unavailable' >> "$GITHUB_OUTPUT"
  echo "::warning::Optional same-run artifact unavailable; continuing with validated fallback (selector=$selector_type exit=$status)" >&2
  echo "[optional-run-artifacts] result=unavailable selector=$selector_type exit=$status" >&2
fi
