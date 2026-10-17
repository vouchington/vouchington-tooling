#!/usr/bin/env bash
# Sourced by ghcr-main-history.sh. Walks OCI manifests through manifests[] and subject.

# registry_token <image> <owner> <work-dir>: exchanges the GitHub token for a registry pull token
# (GHCR's documented /token endpoint, Basic auth) and prints it. Credentials go to curl on stdin.
registry_token() {
  local image="$1" owner="$2" dir="$3" token registry
  registry="${GHCR_REGISTRY_URL:-https://ghcr.io}"
  token="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
  if [ -z "$token" ]; then
    token=$(gh auth token) || {
      echo '::error::No GH_TOKEN or GITHUB_TOKEN, and gh auth token failed' >&2
      return 1
    }
  fi
  if ! printf 'user = "%s:%s"\n' "$owner" "$token" |
    curl -fsS -K - "$registry/token?scope=repository:$image:pull" \
      > "$dir/token.json" 2> "$dir/curl-error"; then
    printf '::error::Could not get a registry token for %s: %s\n' "$image" \
      "$(cat "$dir/curl-error")" >&2
    return 1
  fi
  jq -er '.token | select(type == "string" and . != "")' "$dir/token.json" || {
    printf '::error::Registry token response for %s had no token\n' "$image" >&2
    return 1
  }
}

# resolve_referenced <image> <owner> <work-dir> <roots-file>: prints every digest reachable from
# the root digests (one per line in the file), roots included. Returns non-zero on any failure, so
# the caller deletes nothing.
resolve_referenced() {
  local image="$1" owner="$2" dir="$3" digest registry_bearer registry accept
  registry="${GHCR_REGISTRY_URL:-https://ghcr.io}"
  registry_bearer=$(registry_token "$image" "$owner" "$dir") || return 1
  accept='application/vnd.oci.image.index.v1+json'
  accept="$accept,application/vnd.oci.image.manifest.v1+json"
  accept="$accept,application/vnd.docker.distribution.manifest.list.v2+json"
  accept="$accept,application/vnd.docker.distribution.manifest.v2+json"

  : > "$dir/seen"
  cp "$4" "$dir/queue" || return 1
  while [ -s "$dir/queue" ]; do
    digest=$(head -n 1 "$dir/queue")
    sed -i.bak 1d "$dir/queue" || return 1
    rm -f "$dir/queue.bak"
    [ -n "$digest" ] || continue
    ! grep -qxF "$digest" "$dir/seen" || continue
    echo "$digest" >> "$dir/seen"
    if ! printf 'header = "Authorization: Bearer %s"\n' "$registry_bearer" |
      curl -fsS -K - -H "Accept: $accept" "$registry/v2/$image/manifests/$digest" \
        > "$dir/manifest" 2> "$dir/curl-error"; then
      printf '::error::Could not read manifest %s of %s: %s\n' "$digest" "$image" \
        "$(cat "$dir/curl-error")" >&2
      return 1
    fi
    if ! jq -r '[(.manifests // [])[].digest, (.subject.digest // empty)] | .[]' \
      "$dir/manifest" >> "$dir/queue" 2> "$dir/jq-error"; then
      printf '::error::Could not parse manifest %s of %s: %s\n' "$digest" "$image" \
        "$(cat "$dir/jq-error")" >&2
      return 1
    fi
  done
  cat "$dir/seen"
}
