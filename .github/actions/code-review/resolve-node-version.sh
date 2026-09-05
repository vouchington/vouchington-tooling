#!/usr/bin/env bash
set -euo pipefail
version_file="${VOUCHINGTON_TOOLING_ROOT:-$GITHUB_ACTION_PATH/../../..}/.nvmrc"
if [ ! -f "$version_file" ]; then
  echo "::error::Trusted Node version file is missing: $version_file"
  exit 1
fi
version="$(cat "$version_file" && printf x)"
version="${version%x}"
if [[ "$version" == *$'\n' ]]; then
  version="${version%$'\n'}"
fi
if [[ ! "$version" =~ ^[0-9]+$ ]]; then
  echo "::error::Trusted .nvmrc must contain one numeric Node major version."
  exit 1
fi
printf 'version=%s\n' "$version" >> "$GITHUB_OUTPUT"
