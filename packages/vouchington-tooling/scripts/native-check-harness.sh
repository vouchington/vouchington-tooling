#!/usr/bin/env bash
# shellcheck shell=bash

# Source this library from a consumer-owned check script. The consumer supplies
# command names and commands; this library records stable timing and diagnostics.

native_check_init() {
  : "${1:?native_check_init requires a Markdown summary path}"
  : "${2:?native_check_init requires a JSONL result path}"
  NATIVE_CHECK_SUMMARY_FILE="$1"
  NATIVE_CHECK_JSONL_FILE="$2"
  : >"${NATIVE_CHECK_SUMMARY_FILE}"
  : >"${NATIVE_CHECK_JSONL_FILE}"
}

native_check_classify() {
  case "${1:?native_check_classify requires an exit status}" in
    0) printf 'passed' ;;
    124) printf 'timed-out' ;;
    126|127) printf 'unavailable' ;;
    137) printf 'killed' ;;
    *) printf 'failed' ;;
  esac
}

native_check_run() {
  : "${NATIVE_CHECK_SUMMARY_FILE:?call native_check_init first}"
  : "${NATIVE_CHECK_JSONL_FILE:?call native_check_init first}"
  local name="${1:?native_check_run requires a name}"
  shift
  [ "${1:-}" = '--' ] || {
    echo "native_check_run requires -- before the command" >&2
    return 2
  }
  shift
  [ "$#" -gt 0 ] || {
    echo "native_check_run requires a command" >&2
    return 2
  }
  local started output status finished classification lines
  started="$(date +%s)"
  output="$(mktemp "${TMPDIR:-/tmp}/native-check-${name//[^A-Za-z0-9._-]/_}.XXXXXX")"
  if "$@" >"${output}" 2>&1; then
    status=0
  else
    status=$?
  fi
  finished="$(date +%s)"
  classification="$(native_check_classify "${status}")"
  lines="${NATIVE_CHECK_TAIL_LINES:-80}"
  case "${lines}" in *[!0-9]*|'') lines=80 ;; esac
  {
    printf '| %s | %s | %s | %ss |\n' "${name}" "${classification}" "${status}" "$((finished - started))"
    if [ "${status}" -ne 0 ]; then
      printf '\n### %s (%s, exit %s)\n\n```text\n' "${name}" "${classification}" "${status}"
      tail -n "${lines}" "${output}"
      printf '\n```\n'
    fi
  } >>"${NATIVE_CHECK_SUMMARY_FILE}"
  node --input-type=module -e '
    process.stdout.write(`${JSON.stringify({
      classification: process.argv[3],
      durationSeconds: Number(process.argv[5]),
      exitCode: Number(process.argv[4]),
      name: process.argv[2],
    })}\n`)
  ' _ "${name}" "${classification}" "${status}" "$((finished - started))" >>"${NATIVE_CHECK_JSONL_FILE}"
  rm -f "${output}"
  return "${status}"
}

native_check_publish_summary() {
  : "${NATIVE_CHECK_SUMMARY_FILE:?call native_check_init first}"
  : "${NATIVE_CHECK_JSONL_FILE:?call native_check_init first}"
  local destination="${1:-${GITHUB_STEP_SUMMARY:-}}"
  if [ -n "${destination}" ]; then
    {
      printf '## Check summary\n\n| Check | Result | Exit | Duration |\n| --- | --- | --- | --- |\n'
      cat "${NATIVE_CHECK_SUMMARY_FILE}"
    } >>"${destination}"
  else
    cat "${NATIVE_CHECK_SUMMARY_FILE}"
  fi
}
