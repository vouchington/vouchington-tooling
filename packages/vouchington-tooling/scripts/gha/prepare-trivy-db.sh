#!/usr/bin/env bash
set -euo pipefail

mirror_repository="${TRIVY_DB_MIRROR_REPOSITORY:-mirror.gcr.io/aquasec/trivy-db:2}"
official_repository="${TRIVY_DB_OFFICIAL_REPOSITORY:-ghcr.io/aquasecurity/trivy-db:2}"
download_timeout="${TRIVY_DB_TIMEOUT:-75s}"

download_database() {
  trivy image \
    --download-db-only \
    --no-progress \
    --timeout "$download_timeout" \
    --db-repository "$1"
}

mirror_exit=0
download_database "$mirror_repository" || mirror_exit=$?
if [ "$mirror_exit" -eq 0 ]; then
  echo "Trivy vulnerability database prepared from the Google mirror"
  exit 0
fi

echo "Trivy database mirror failed with exit ${mirror_exit}; retrying from official GHCR"
official_exit=0
download_database "$official_repository" || official_exit=$?
if [ "$official_exit" -eq 0 ]; then
  echo "Trivy vulnerability database prepared from official GHCR"
  exit 0
fi

echo "Trivy vulnerability database download failed from the Google mirror (exit ${mirror_exit}) and official GHCR (exit ${official_exit})" >&2
exit "$official_exit"
