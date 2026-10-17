#!/usr/bin/env bash
# Sourced by ghcr-package-retention.sh for --main-history. Expects package_root, packages, apply,
# keep_main and min_age_days from the caller.

# shellcheck source=/dev/null
. "$(dirname "${BASH_SOURCE[0]}")/ghcr-referenced-digests.sh"

# The registry namespace: the org, or the authenticated user for user-owned packages.
gh_owner() {
  if [ -n "${GHCR_OWNER:-}" ]; then echo "$GHCR_OWNER"; else gh api user --jq .login; fi
}

prune_main_history() {
  # A zero keep count would delete every main image in one run.
  case "$keep_main" in
    '' | *[!0-9]*) keep_main=0 ;;
  esac
  if [ "$((10#$keep_main))" -lt 1 ]; then
    echo 'ghcr-package-retention: GHCR_KEEP_MAIN must be a positive integer' >&2
    exit 2
  fi
  case "$min_age_days" in
    '' | *[!0-9]*)
      echo 'ghcr-package-retention: GHCR_UNMERGED_MIN_AGE_DAYS must be a non-negative integer' >&2
      exit 2
      ;;
  esac

  # A shallow history would make every older main revision look unmerged.
  if [ "$(git rev-parse --is-shallow-repository)" != false ]; then
    echo 'ghcr-package-retention: --main-history needs the full main history (fetch-depth: 0)' >&2
    exit 2
  fi

  # Global on purpose: the EXIT trap runs after this function returns.
  work=$(mktemp -d)
  trap 'rm -rf "$work"' EXIT
  git rev-list HEAD > "$work/main-revisions"
  local cutoff
  cutoff=$(($(date -u +%s) - min_age_days * 86400))

  local plan='
  ($revisions | split("\n") | map(select(. != "") | {key: ., value: true}) | from_entries) as $main
  | (add // []) as $versions
  | def tags: .metadata.container.tags;
    def created: .created_at | fromdateiso8601;
    def idle: [.created_at, .updated_at] | map(fromdateiso8601) | max < $cutoff;
    def attachment: tags | all(startswith("sha256-"));
    def canonical: tags | length == 1 and (.[0] | test("^sha-[0-9a-f]{40}$"));
    def merged: $main[tags[0][4:]] == true;
    ($versions | map(select(canonical and merged)) | sort_by(.created_at, .id) | reverse
      | .[$keep:] | map(. + {reason: "main"})) as $old_main
    | ($versions | map(select(canonical and (merged | not) and idle) | . + {reason: "unmerged"}))
      as $unmerged
    | ($old_main + $unmerged | map(.id)) as $doomed
    | ($versions | map(select((attachment | not) and (.id | IN($doomed[]) | not)) | created)
      | min) as $oldest_image
    | ($versions | map(select(attachment and idle and $oldest_image != null
        and created < $oldest_image - 86400) | . + {reason: "orphan"})) as $orphans
    | {roots: ($versions | map(select((attachment | not) and (.id | IN($doomed[]) | not)) | .name)),
       candidates: ($old_main + $unmerged + $orphans | map({id, name, reason,
         tags: (tags | if length == 0 then "<untagged>" else join(",") end)}))}'
  local filter='.candidates | map(select(.name | IN($referenced[]) | not))[]
    | "\(.id) \(.tags) \(.reason)"'

  local deleted_total=0 package path error deletions id tags reason referenced image resolved
  for package in "${packages[@]}"; do
    path="$package_root/$package/versions"
    if ! error=$(gh api --paginate "$path?per_page=100" 2>&1 > "$work/pages"); then
      case "$error" in
        # A package that was never published has nothing to prune.
        *'(HTTP 404)'*)
          echo "· $package: no such package, skipping"
          continue
          ;;
      esac
      printf '::error::Could not list %s versions: %s\n' "$package" "$error" >&2
      exit 1
    fi

    jq -s --rawfile revisions "$work/main-revisions" --argjson keep "$keep_main" \
      --argjson cutoff "$cutoff" "$plan" "$work/pages" > "$work/plan"
    # Never delete a digest that a kept image or index still references (platform manifests,
    # attestations, subjects). An unreadable kept manifest aborts rather than risk a delete.
    referenced='[]'
    if [ "$(jq '.candidates | length' "$work/plan")" -gt 0 ]; then
      jq -r '.roots[]' "$work/plan" > "$work/roots"
      image="$(gh_owner)/$(printf '%b' "${package//%/\\x}")"
      resolved=$(resolve_referenced "$image" "$work" "$work/roots") || exit 1
      referenced=$(printf '%s\n' "$resolved" | jq -R . | jq -s .)
    fi
    deletions=$(jq -r --argjson referenced "$referenced" "$filter" "$work/plan")
    echo "· $package: $(jq -s 'add // [] | length' "$work/pages") version(s)"
    while read -r id tags reason; do
      [ -n "$id" ] || continue
      if [ "$apply" = true ]; then
        gh api --method DELETE "$path/$id" > /dev/null < /dev/null
        echo "  deleted $id $tags ($reason)"
      else
        echo "  would delete $id $tags ($reason)"
      fi
      deleted_total=$((deleted_total + 1))
    done <<< "$deletions"
  done

  if [ "$apply" = true ]; then
    echo "Deleted $deleted_total version(s)."
  else
    echo "Dry run: $deleted_total version(s) would be deleted. Pass --apply to delete."
  fi
}
