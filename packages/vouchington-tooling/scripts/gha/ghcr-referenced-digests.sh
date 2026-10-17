#!/usr/bin/env bash
# Sourced by ghcr-main-history.sh. Walks OCI manifests through manifests[] and subject.

# resolve_referenced <image> <work-dir> <roots-file>: prints every digest reachable from the root
# digests (one per line in the file), roots included. Fails, so nothing is deleted, when a manifest
# cannot be fetched.
resolve_referenced() {
  local image="$1" dir="$2" digest token registry accept
  shift 2
  registry="${GHCR_REGISTRY_URL:-https://ghcr.io}"
  token="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
  [ -n "$token" ] || token=$(gh auth token)
  accept='application/vnd.oci.image.index.v1+json'
  accept="$accept,application/vnd.oci.image.manifest.v1+json"
  accept="$accept,application/vnd.docker.distribution.manifest.list.v2+json"
  accept="$accept,application/vnd.docker.distribution.manifest.v2+json"

  : > "$dir/seen"
  cp "$1" "$dir/queue"
  while [ -s "$dir/queue" ]; do
    digest=$(head -n 1 "$dir/queue")
    sed -i.bak 1d "$dir/queue" && rm -f "$dir/queue.bak"
    [ -n "$digest" ] || continue
    ! grep -qxF "$digest" "$dir/seen" || continue
    echo "$digest" >> "$dir/seen"
    # The token goes to curl through stdin so it never appears in an argument list.
    if ! printf 'header = "Authorization: Bearer %s"\n' "$(printf '%s' "$token" | base64 | tr -d '\n')" |
      curl -fsS -K - -H "Accept: $accept" "$registry/v2/$image/manifests/$digest" \
        > "$dir/manifest" 2> "$dir/curl-error"; then
      printf '::error::Could not read manifest %s of %s: %s\n' "$digest" "$image" \
        "$(cat "$dir/curl-error")" >&2
      return 1
    fi
    jq -r '[(.manifests // [])[].digest, (.subject.digest // empty)] | .[]' "$dir/manifest" \
      >> "$dir/queue"
  done
  cat "$dir/seen"
}
