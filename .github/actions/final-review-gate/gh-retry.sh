gh_capture_retry() {
  local accepted="$1"; shift
  local attempt=1 status stdout_file stderr_file stderr_output http_status reason marker
  stdout_file="stdout-$$.log"; stderr_file="stderr-$$.log"
  while true; do
    status=0; "$@" > "$stdout_file" 2> "$stderr_file" || status=$?
    if [ "$status" -eq 0 ]; then
      GH_RETRY_OUTPUT="$(cat "$stdout_file")"
      rm -f "$stdout_file" "$stderr_file"
      return 0
    fi
    stderr_output="$(cat "$stderr_file")"; http_status=""
    if [[ "$stderr_output" =~ HTTP\ ([0-9]{3}) ]]; then http_status="${BASH_REMATCH[1]}"; fi
    if [ -n "$http_status" ] && [ "$http_status" = "$accepted" ]; then
      GH_RETRY_OUTPUT=''; rm -f "$stdout_file" "$stderr_file"; return 0
    fi
    reason=""
    if [ -z "$http_status" ]; then
      while IFS= read -r marker; do case "$stderr_output" in *"$marker"*) reason=transport;; esac; done <<< "$GH_RETRY_TRANSPORT_MARKERS"
    elif [ "$http_status" = 403 ] || [ "$http_status" = 429 ] || [ "$http_status" -ge 500 ]; then
      reason="HTTP $http_status"
    fi
    if [ -z "$reason" ] || [ "$attempt" -ge "$GH_RETRY_ATTEMPTS" ]; then
      rm -f "$stdout_file" "$stderr_file"; printf '%s\n' "$stderr_output" >&2; return "$status"
    fi
    echo "::warning::GitHub API $reason; retrying attempt $((attempt + 1))/$GH_RETRY_ATTEMPTS."
    rm -f "$stdout_file" "$stderr_file"
    sleep "$((attempt * GH_RETRY_BACKOFF_SECONDS))"; attempt=$((attempt + 1))
  done
}
