#!/usr/bin/env bash
# Classify GitHub authors by their live permission on one repository.
#
# stdin:  JSON array of {"login": string, "type": string} (GitHub user objects work as-is).
# stdout: {"trusted": [login...], "untrusted": [login...]}, each sorted and deduplicated.
#
# Trusted means the legacy `permission` field is admin or write (maintain maps to write), or the
# author is a GitHub App bot (type "Bot"), which only an installed app can be. A definitive 404 means
# no permission. Any other lookup failure exits non-zero so callers fail closed.
set -euo pipefail

if [ "$#" -ne 1 ] || ! [[ "$1" =~ ^[A-Za-z0-9_-][A-Za-z0-9_.-]*/[A-Za-z0-9_-][A-Za-z0-9_.-]*$ ]]; then
  echo "usage: gha-collaborator-trust.sh <owner/repo> < authors.json" >&2
  exit 2
fi
repository="$1"

if ! authors="$(jq -ce '
  if type == "array" and all(.[]; (.login | type) == "string" and (.login | length) > 0)
  then [.[] | {login, type: (.type // "")}] | unique_by(.login)
  else error("authors must be an array of {login, type}")
  end')"; then
  echo "::error::gha-collaborator-trust: stdin must be a JSON array of {login, type}" >&2
  exit 2
fi

results="$(mktemp)"
errors="$(mktemp)"
trap 'rm -f "$results" "$errors"' EXIT

while IFS=$'\t' read -r login type; do
  verdict=untrusted
  if [ "$type" = "Bot" ]; then
    verdict=trusted
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
done < <(jq -r '.[] | [.login, .type] | @tsv' <<<"$authors")

jq -Rn '
  [inputs | split("\t")] as $rows
  | {
      trusted: [$rows[] | select(.[0] == "trusted") | .[1]] | sort,
      untrusted: [$rows[] | select(.[0] == "untrusted") | .[1]] | sort
    }' <"$results"
