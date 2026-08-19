#!/usr/bin/env bash

ci_download_failed() {
  local url="$1"
  local status="${2:-000}"
  local message="DOWNLOAD FAILED: ${url} → HTTP ${status}"

  echo "$message"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    echo "$message" >> "$GITHUB_STEP_SUMMARY" || true
  fi
}

ci_download_to() {
  if [ "$#" -lt 2 ]; then
    echo "Error: ci_download_to requires both url and destination arguments" >&2
    return 1
  fi
  local url="$1"
  local destination="$2"
  shift 2

  local http_status
  local curl_status

  if http_status=$(
    curl \
      --location \
      --silent \
      --show-error \
      --output "$destination" \
      --write-out '%{http_code}' \
      --connect-timeout 30 \
      --max-time 120 \
      "$@" \
      "$url"
  ); then
    curl_status=0
  else
    curl_status=$?
  fi

  if [ "$curl_status" -ne 0 ] || ! [[ "$http_status" =~ ^2[0-9][0-9]$ ]]; then
    rm -f "$destination"
    ci_download_failed "$url" "${http_status:-000}"
    return 1
  fi
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  ci_download_to "$@"
fi
