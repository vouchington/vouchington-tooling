#!/usr/bin/env bash
# Keep the most recent KEEP_MIN non-protected GHCR package versions, plus any
# version whose tags match the protected prefix/contains rules.
set -euo pipefail

KEEP_MIN="${KEEP_MIN:-10}"
OWNER_TYPE="${GHCR_OWNER_TYPE:-user}"
OWNER="${GHCR_OWNER:-}"
PROTECTED_PREFIX="${PROTECTED_TAG_PREFIX:-latest}"
PROTECTED_CONTAINS="${PROTECTED_TAG_CONTAINS:-buildcache}"

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

if [ "$#" -eq 0 ]; then
  echo "usage: ghcr-package-retention.sh <url-encoded-package>..." >&2
  exit 2
fi

for pkg in "$@"; do
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

    printf '  delete: version %s\n' "$version_id"
    gh api -X DELETE "${package_root}/$pkg/versions/$version_id" || true
  done < <(gh api \
    "${package_root}/$pkg/versions?per_page=100" \
    --jq '.[] | @json')
done
