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
repository="$GITHUB_REPOSITORY"
case "$github_host" in
  github.com|*.ghe.com) ;;
  *)
    if [ -z "${GH_ENTERPRISE_TOKEN:-${GITHUB_ENTERPRISE_TOKEN:-}}" ]; then
      enterprise_token="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
      [ -z "$enterprise_token" ] || export GH_ENTERPRISE_TOKEN="$enterprise_token"
    fi
    ;;
esac

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
  artifacts=$(list_artifact_names) || return $?
  found=0
  while IFS= read -r candidate; do
    if [ "$candidate" = "$artifact" ]; then
      found=1
      break
    fi
  done < <(printf '%s\n' "$artifacts")
  [ "$found" -eq 1 ] || return 3
  echo "[optional-run-artifacts] attempt selector=$selector_type" >&2
  GH_HOST="$github_host" gh run download "$GITHUB_RUN_ID" --repo "$repository" --name "$artifact" --dir "$directory"
}

list_artifact_names_once() {
  GH_HOST="$github_host" gh api \
    --paginate \
    "repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID/artifacts?per_page=100" \
    --jq '.artifacts[] | select(.expired | not) | .name'
}

list_artifact_names() {
  local attempt status=0 delay artifact_names
  for attempt in 1 2 3; do
    if artifact_names=$(list_artifact_names_once); then
      [ -z "$artifact_names" ] || printf '%s\n' "$artifact_names"
      return 0
    else
      status=$?
    fi
    case "$status" in 130|143) return "$status" ;; esac
    if [ "$attempt" -lt 3 ]; then
      delay=2
      [ "$attempt" -eq 2 ] && delay=5
      echo "::warning::Optional same-run artifact listing failed (attempt $attempt/3 exit=$status); retrying in ${delay}s" >&2
      if sleep "$delay"; then :; else return $?; fi
    fi
  done
  echo "[optional-run-artifacts] listing exhausted attempts=3 exit=$status" >&2
  return "$status"
}

download_pattern() {
  artifacts=$(list_artifact_names) || return $?
  if [ -n "$artifacts" ]; then
    artifacts=$(printf '%s\n' "$artifacts" | awk '!seen[$0]++')
  fi
  selected_artifacts=()
  while IFS= read -r artifact; do
    [ -n "$artifact" ] || continue
    # shellcheck disable=SC2254
    # selector is the caller's intended glob pattern.
    case "$artifact" in
      $selector) ;;
      *) continue ;;
    esac
    validate_artifact_name "$artifact" || return $?
    selected_artifacts+=("$artifact")
    echo "[optional-run-artifacts] selected artifact=$artifact" >&2
  done < <(printf '%s\n' "$artifacts")
  count=${#selected_artifacts[@]}
  echo "[optional-run-artifacts] selection selector=pattern count=$count" >&2
  [ "$count" -gt 0 ] || return 3
  for artifact in "${selected_artifacts[@]}"; do
    echo "[optional-run-artifacts] attempt artifact=$artifact" >&2
    GH_HOST="$github_host" gh run download "$GITHUB_RUN_ID" --repo "$repository" --name "$artifact" --dir "$destination/$artifact" || return $?
  done
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
    3)
      echo 'availability=unavailable' >> "$GITHUB_OUTPUT"
      echo "::warning::Optional same-run artifact unavailable; continuing with validated fallback (selector=$selector_type exit=$status)" >&2
      echo "[optional-run-artifacts] result=unavailable selector=$selector_type exit=$status" >&2
      ;;
    *)
      echo "[optional-run-artifacts] result=error selector=$selector_type exit=$status" >&2
      exit "$status"
      ;;
  esac
fi
