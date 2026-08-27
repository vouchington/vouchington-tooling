#!/usr/bin/env bash
# shellcheck shell=bash

# Source this library from a consumer-owned check script. The consumer supplies
# command names and commands; this library records stable timing and diagnostics.

native_check_path_identity() {
  node --input-type=module -e '
    import { lstatSync, readlinkSync, realpathSync, statSync } from "node:fs"
    import { basename, dirname, resolve } from "node:path"
    function isCaseInsensitive(parent) {
      if (process.platform === "win32") return true
      const parentStat = statSync(parent, { bigint: true })
      for (let index = parent.length - 1; index >= 0; index -= 1) {
        const character = parent[index]
        if (!/[A-Za-z]/.test(character)) continue
        const toggled = `${parent.slice(0, index)}${character === character.toLowerCase() ? character.toUpperCase() : character.toLowerCase()}${parent.slice(index + 1)}`
        try {
          const toggledStat = statSync(toggled, { bigint: true })
          return toggledStat.dev === parentStat.dev && toggledStat.ino === parentStat.ino
        } catch {
          return false
        }
      }
      return false
    }
    function identity(target, seen = new Set()) {
      const absolute = resolve(target)
      if (seen.has(absolute)) throw new Error("path contains a symbolic-link cycle")
      seen.add(absolute)
      try {
        const stat = statSync(absolute, { bigint: true })
        return `inode:${stat.dev}:${stat.ino}`
      } catch (error) {
        if (error?.code !== "ENOENT") throw error
      }
      try {
        if (lstatSync(absolute).isSymbolicLink())
          return identity(resolve(dirname(absolute), readlinkSync(absolute)), seen)
      } catch (error) {
        if (error?.code !== "ENOENT") throw error
      }
      const parent = realpathSync.native(dirname(absolute))
      const parentStat = statSync(parent, { bigint: true })
      const name = basename(absolute).normalize("NFC")
      return `path:${parentStat.dev}:${parentStat.ino}:${isCaseInsensitive(parent) ? name.toLowerCase() : name}`
    }
    process.stdout.write(identity(process.argv[1]))
  ' "$1"
}

native_check_init() {
  : "${1:?native_check_init requires a Markdown summary path}"
  : "${2:?native_check_init requires a JSONL result path}"
  NATIVE_CHECK_SUMMARY_FILE="$1"
  NATIVE_CHECK_JSONL_FILE="$2"
  NATIVE_CHECK_DIAGNOSTICS_FILE="${NATIVE_CHECK_SUMMARY_FILE}.diagnostics"
  local summary_identity jsonl_identity diagnostics_identity
  summary_identity="$(native_check_path_identity "${NATIVE_CHECK_SUMMARY_FILE}")" || return 2
  jsonl_identity="$(native_check_path_identity "${NATIVE_CHECK_JSONL_FILE}")" || return 2
  diagnostics_identity="$(native_check_path_identity "${NATIVE_CHECK_DIAGNOSTICS_FILE}")" || return 2
  if [ "${summary_identity}" = "${jsonl_identity}" ] ||
    [ "${summary_identity}" = "${diagnostics_identity}" ] ||
    [ "${diagnostics_identity}" = "${jsonl_identity}" ]; then
    echo "native_check_init summary, JSONL, and diagnostics paths must differ" >&2
    return 2
  fi
  : >"${NATIVE_CHECK_SUMMARY_FILE}"
  : >"${NATIVE_CHECK_JSONL_FILE}"
  : >"${NATIVE_CHECK_DIAGNOSTICS_FILE}"
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
  case "${name}" in ''|*[!A-Za-z0-9._-]*)
    echo "native_check_run name must contain only letters, digits, dots, underscores, and hyphens" >&2
    return 2
  esac
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
  local started output status finished classification lines max_output_kib capture pipeline
  started="$(date +%s)"
  output="$(mktemp "${TMPDIR:-/tmp}/native-check-${name//[^A-Za-z0-9._-]/_}.XXXXXX")"
  max_output_kib="${NATIVE_CHECK_MAX_OUTPUT_KIB:-1024}"
  case "${max_output_kib}" in 0|*[!0-9]*|'') max_output_kib=1024 ;; esac
  if [ "${#max_output_kib}" -gt 5 ]; then
    max_output_kib=10240
  else
    max_output_kib="$((10#${max_output_kib}))"
    if [ "${max_output_kib}" -eq 0 ]; then max_output_kib=1024; fi
    if [ "${max_output_kib}" -gt 10240 ]; then max_output_kib=10240; fi
  fi
  capture="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/native-check-capture.mjs"
  if "$@" 2>&1 | node "${capture}" "$((max_output_kib * 1024))" >"${output}"; then
    pipeline=("${PIPESTATUS[@]}")
  else
    pipeline=("${PIPESTATUS[@]}")
  fi
  if [ "${pipeline[1]}" -ne 0 ]; then
    echo "native_check_run: output capture failed with ${pipeline[1]}" >&2
    rm -f "${output}"
    return "${pipeline[1]}"
  fi
  status="${pipeline[0]}"
  finished="$(date +%s)"
  classification="$(native_check_classify "${status}")"
  lines="${NATIVE_CHECK_TAIL_LINES:-80}"
  case "${lines}" in *[!0-9]*|'') lines=80 ;; esac
  if [ "${#lines}" -gt 4 ]; then
    lines=1000
  else
    lines="$((10#${lines}))"
    if [ "${lines}" -eq 0 ]; then lines=80; fi
    if [ "${lines}" -gt 1000 ]; then lines=1000; fi
  fi
  {
    printf '| %s | %s | %s | %ss |\n' "${name}" "${classification}" "${status}" "$((finished - started))"
  } >>"${NATIVE_CHECK_SUMMARY_FILE}"
  if [ "${status}" -ne 0 ]; then
    {
      printf '\n### %s (%s, exit %s)\n\n' "${name}" "${classification}" "${status}"
      tail -n "${lines}" "${output}" | sed 's/^/    /'
      printf '\n'
    } >>"${NATIVE_CHECK_DIAGNOSTICS_FILE}"
  fi
  if ! node --input-type=module -e '
    process.stdout.write(`${JSON.stringify({
      classification: process.argv[3],
      durationSeconds: Number(process.argv[5]),
      exitCode: Number(process.argv[4]),
      name: process.argv[2],
    })}\n`)
  ' _ "${name}" "${classification}" "${status}" "$((finished - started))" >>"${NATIVE_CHECK_JSONL_FILE}"; then
    rm -f "${output}"
    return 1
  fi
  rm -f "${output}"
  return "${status}"
}

native_check_publish_summary() {
  : "${NATIVE_CHECK_SUMMARY_FILE:?call native_check_init first}"
  : "${NATIVE_CHECK_JSONL_FILE:?call native_check_init first}"
  local destination="${1:-${GITHUB_STEP_SUMMARY:-}}"
  if [ -n "${destination}" ]; then
    local destination_identity summary_identity jsonl_identity diagnostics_identity
    destination_identity="$(native_check_path_identity "${destination}")" || return 2
    summary_identity="$(native_check_path_identity "${NATIVE_CHECK_SUMMARY_FILE}")" || return 2
    jsonl_identity="$(native_check_path_identity "${NATIVE_CHECK_JSONL_FILE}")" || return 2
    diagnostics_identity="$(native_check_path_identity "${NATIVE_CHECK_DIAGNOSTICS_FILE}")" || return 2
    if [ "${destination_identity}" = "${jsonl_identity}" ] ||
      [ "${destination_identity}" = "${diagnostics_identity}" ]; then
      echo "native_check_publish_summary destination must differ from JSONL and diagnostics paths" >&2
      return 2
    fi
    if [ "${destination_identity}" = "${summary_identity}" ]; then
      destination="${NATIVE_CHECK_SUMMARY_FILE}"
      local staged_summary
      staged_summary="$(mktemp "${destination}.publish.XXXXXX")"
      {
        printf '## Check summary\n\n| Check | Result | Exit | Duration |\n| --- | --- | --- | --- | --- |\n'
        cat "${NATIVE_CHECK_SUMMARY_FILE}"
        cat "${NATIVE_CHECK_DIAGNOSTICS_FILE}"
      } >"${staged_summary}"
      mv "${staged_summary}" "${destination}"
      return
    fi
    {
        printf '## Check summary\n\n| Check | Result | Exit | Duration |\n| --- | --- | --- | --- |\n'
      cat "${NATIVE_CHECK_SUMMARY_FILE}"
      cat "${NATIVE_CHECK_DIAGNOSTICS_FILE}"
    } >>"${destination}"
  else
    cat "${NATIVE_CHECK_SUMMARY_FILE}"
    cat "${NATIVE_CHECK_DIAGNOSTICS_FILE}"
  fi
}
