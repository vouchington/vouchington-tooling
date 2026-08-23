#!/usr/bin/env bash
set -euo pipefail

if [ "$(uname -s)" != "Linux" ]; then
  exit 0
fi

timeout_seconds="${APT_LOCK_TIMEOUT_SECONDS:-120}"
case "$timeout_seconds" in
  *[!0-9]* | '')
    echo "::error::wait-for-apt-locks: APT_LOCK_TIMEOUT_SECONDS must be a non-negative integer"
    exit 2
    ;;
esac

lock_probe_cmd=()
lock_probe_detail_cmd=()
if command -v fuser >/dev/null 2>&1; then
  lock_probe_cmd=(fuser)
  lock_probe_detail_cmd=(fuser -v)
elif command -v lsof >/dev/null 2>&1; then
  lock_probe_cmd=(lsof)
  lock_probe_detail_cmd=(lsof -w)
else
  echo "::warning::fuser and lsof are unavailable; skipping apt/dpkg lock probe"
  exit 0
fi
if command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
  lock_probe_cmd=(sudo -n "${lock_probe_cmd[@]}")
  lock_probe_detail_cmd=(sudo -n "${lock_probe_detail_cmd[@]}")
fi

deadline=$((SECONDS + timeout_seconds))
lock_paths=(
  /var/lib/apt/lists/lock
  /var/lib/dpkg/lock
  /var/lib/dpkg/lock-frontend
  /var/cache/apt/archives/lock
)
busy_paths=()

while true; do
  busy_paths=()
  for lock_path in "${lock_paths[@]}"; do
    if [ -e "$lock_path" ] && "${lock_probe_cmd[@]}" "$lock_path" >/dev/null 2>&1; then
      busy_paths+=("$lock_path")
    fi
  done

  if [ "${#busy_paths[@]}" -eq 0 ]; then
    exit 0
  fi
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "::error::Timed out waiting for apt/dpkg locks after ${timeout_seconds}s: ${busy_paths[*]}"
    "${lock_probe_detail_cmd[@]}" "${busy_paths[@]}" || true
    exit 1
  fi
  echo "::warning::Waiting for apt/dpkg locks: ${busy_paths[*]}"
  sleep 5
done
