#!/usr/bin/env bash
# Prune GHCR package versions. Two strategies:
#
# Default (recent): keep the most recent KEEP_MIN non-protected versions, plus any version whose
# tags match the protected prefix/contains rules. Deletes unless --dry-run is passed.
#
# --main-history: for images published as <package>:sha-<40 hex> by merge groups and main. Run from
# a full-history checkout. Each version is one of:
# - An image, with a tag other than sha256-*. Only an image whose single tag is sha-<40 hex> is
#   deleted: past the newest GHCR_KEEP_MAIN commits reachable from HEAD, or unreachable (an
#   ejected or failed merge group) once created and updated GHCR_UNMERGED_MIN_AGE_DAYS ago.
# - An attachment: untagged or tagged only sha256-*. Attestations and their referrer indexes are
#   pushed after their image, and platform manifests moments before it, so an attachment created
#   over a day before the oldest surviving image, and idle for the same age, belongs to none.
# Packages that do not exist (HTTP 404) are skipped. Defaults to a dry run; pass --apply to delete.
#
# Packages come from the arguments, or from GHCR_PACKAGES (space separated) when none are given.
set -euo pipefail

KEEP_MIN="${KEEP_MIN:-10}"
OWNER_TYPE="${GHCR_OWNER_TYPE:-user}"
OWNER="${GHCR_OWNER:-}"
PROTECTED_PREFIX="${PROTECTED_TAG_PREFIX:-latest}"
PROTECTED_CONTAINS="${PROTECTED_TAG_CONTAINS:-buildcache}"
keep_main="${GHCR_KEEP_MAIN:-30}"
min_age_days="${GHCR_UNMERGED_MIN_AGE_DAYS:-7}"
main_history=false
apply=''

packages=()
for argument in "$@"; do
  case "$argument" in
    --apply) apply=true ;;
    --dry-run) apply=false ;;
    --main-history) main_history=true ;;
    --*)
      echo "ghcr-package-retention: unknown argument: $argument" >&2
      exit 2
      ;;
    *) packages+=("$argument") ;;
  esac
done
if [ "${#packages[@]}" -eq 0 ] && [ -n "${GHCR_PACKAGES:-}" ]; then
  read -r -a packages <<< "$GHCR_PACKAGES"
fi
if [ -z "$apply" ]; then
  if [ "$main_history" = true ]; then apply=false; else apply=true; fi
fi

case "$KEEP_MIN" in
  *[!0-9]* | '')
    echo "ghcr-package-retention: KEEP_MIN must be a non-negative integer" >&2
    exit 2
    ;;
esac

case "$OWNER_TYPE" in
  user) package_root="user/packages/container" ;;
  org)
    [ -n "$OWNER" ] || {
      echo "ghcr-package-retention: GHCR_OWNER is required when GHCR_OWNER_TYPE=org" >&2
      exit 2
    }
    package_root="orgs/${OWNER}/packages/container"
    ;;
  *)
    echo "ghcr-package-retention: GHCR_OWNER_TYPE must be user or org" >&2
    exit 2
    ;;
esac

if [ "${#packages[@]}" -eq 0 ]; then
  echo "usage: ghcr-package-retention.sh [--main-history] [--apply|--dry-run] <url-encoded-package>..." >&2
  exit 2
fi

if [ "$main_history" = true ]; then
  # shellcheck source=/dev/null
  . "$(dirname "${BASH_SOURCE[0]}")/ghcr-main-history.sh"
  prune_main_history
  exit 0
fi

for pkg in "${packages[@]}"; do
  echo "=== Processing $pkg ==="
  count=0
  while IFS= read -r version_json; do
    version_id=$(printf '%s' "$version_json" | jq -r '.id')
    tags=$(printf '%s' "$version_json" | jq -r '[.metadata.container.tags[]?]')

    protected=$(printf '%s' "$tags" |
      jq --arg prefix "$PROTECTED_PREFIX" --arg contains "$PROTECTED_CONTAINS" \
        'map(select(startswith($prefix) or contains($contains))) | length')
    if [ "$protected" -gt 0 ]; then
      printf '  keep (protected tag): version %s\n' "$version_id"
      continue
    fi

    count=$((count + 1))
    if [ "$count" -le "$KEEP_MIN" ]; then
      printf '  keep (recent %d/%d): version %s\n' "$count" "$KEEP_MIN" "$version_id"
      continue
    fi

    if [ "$apply" = true ]; then
      printf '  delete: version %s\n' "$version_id"
      gh api -X DELETE "${package_root}/$pkg/versions/$version_id" || true
    else
      printf '  would delete: version %s\n' "$version_id"
    fi
  done < <(gh api \
    "${package_root}/$pkg/versions?per_page=100" \
    --jq '.[] | @json')
done
