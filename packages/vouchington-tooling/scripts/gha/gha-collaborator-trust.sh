#!/usr/bin/env bash
# Classify GitHub authors by their live permission on one repository.
#
# usage:  gha-collaborator-trust.sh <owner/repo> [--allow-bot <login>]... < authors.json
# stdin:  JSON array of {"login": string, "type": string} (GitHub user objects work as-is).
# stdout: {"trusted": [login...], "untrusted": [login...]}, each sorted and deduplicated.
#
# A user is trusted when the legacy `permission` field is admin or write (maintain maps to
# write). A GitHub App bot (type "Bot") is trusted only when its login is passed with
# --allow-bot, because an app with only issue or pull-request write access can still comment.
# A definitive 404 means no permission. Any other lookup failure exits non-zero so callers
# fail closed.
set -euo pipefail

usage() {
  echo "usage: gha-collaborator-trust.sh <owner/repo> [--allow-bot <login>]... < authors.json" >&2
  exit 2
}

[ "$#" -ge 1 ] || usage
repository="$1"
shift
[[ "$repository" =~ ^[A-Za-z0-9_-][A-Za-z0-9_.-]*/[A-Za-z0-9_-][A-Za-z0-9_.-]*$ ]] || usage

allowed_bots=$'\n'
while [ "$#" -gt 0 ]; do
  if [ "$1" != "--allow-bot" ] || [ "$#" -lt 2 ] || ! [[ "$2" =~ ^[A-Za-z0-9-]+\[bot\]$ ]]; then
    usage
  fi
  allowed_bots+="$2"$'\n'
  shift 2
done

input="$(cat)"
if ! jq -e '
  type == "array" and all(.[];
    type == "object"
    and (.login | type) == "string" and (.login | length) > 0
    and ((.type | type) == "string" or .type == null))' >/dev/null 2>&1 <<<"$input"; then
  echo "::error::gha-collaborator-trust: stdin must be a JSON array of {login, type}" >&2
  exit 2
fi
rows="$(jq -r 'unique_by(.login) | .[] | [.login, (.type // "")] | @tsv' <<<"$input")"

results="$(mktemp)"
errors="$(mktemp)"
trap 'rm -f "$results" "$errors"' EXIT

while IFS=$'\t' read -r login type; do
  [ -n "$login" ] || continue
  verdict=untrusted
  if [ "$type" = "Bot" ]; then
    if [[ "$allowed_bots" == *$'\n'"$login"$'\n'* ]]; then
      verdict=trusted
    fi
  elif [[ "$login" =~ ^[A-Za-z0-9-]+$ ]]; then
    if permission="$(gh api "repos/$repository/collaborators/$login/permission" --jq '.permission' 2>"$errors")"; then
      case "$permission" in
        admin | write) verdict=trusted ;;
      esac
    elif ! grep -q 'HTTP 404' "$errors"; then
      cat "$errors" >&2
      echo "::error::gha-collaborator-trust: permission lookup failed for $login" >&2
      exit 1
    fi
  fi
  printf '%s\t%s\n' "$verdict" "$login" >>"$results"
done <<<"$rows"

jq -Rn '
  [inputs | split("\t")] as $rows
  | {
      trusted: [$rows[] | select(.[0] == "trusted") | .[1]] | sort,
      untrusted: [$rows[] | select(.[0] == "untrusted") | .[1]] | sort
    }' <"$results"
