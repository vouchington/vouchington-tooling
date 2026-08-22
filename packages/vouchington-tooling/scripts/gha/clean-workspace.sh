#!/usr/bin/env bash
set -euo pipefail

EXTRA_KEEP="${EXTRA_KEEP:-}"
EVENT_NAME="${EVENT_NAME:-${GITHUB_EVENT_NAME:-}}"
HEAD_REPO="${HEAD_REPO:-}"
BASE_REPO="${BASE_REPO:-${GITHUB_REPOSITORY:-}}"
PRESERVE_NODE_MODULES="${PRESERVE_NODE_MODULES:-true}"
PR_AUTHOR="${PR_AUTHOR:-}"
DEEPEN="${DEEPEN:-false}"
BASE_REF="${BASE_REF:-main}"
GENERATED_REPAIR_PATHS="${GENERATED_REPAIR_PATHS:-}"

read_pull_request_field() {
  local field="$1"
  [ -n "${GITHUB_EVENT_PATH:-}" ] && [ -f "${GITHUB_EVENT_PATH}" ] || return 0
  node --input-type=module -e '
    import { readFileSync } from "node:fs"
    const event = JSON.parse(readFileSync(process.argv[1], "utf8"))
    const value =
      process.argv[2] === "head"
        ? event.pull_request?.head?.repo?.full_name
        : event.pull_request?.user?.login
    process.stdout.write(value == null ? "" : String(value))
  ' "${GITHUB_EVENT_PATH}" "${field}" 2>/dev/null || true
}

if [ -z "${HEAD_REPO}" ]; then
  HEAD_REPO="$(read_pull_request_field head)"
fi
if [ -z "${PR_AUTHOR}" ]; then
  PR_AUTHOR="$(read_pull_request_field author)"
fi

restore_user_directory_write_bits() {
  local path
  for path in "$@"; do
    if [ -e "${path}" ]; then
      if find -P "${path}" -xdev -type d -exec chmod u+rwx {} +; then
        continue
      fi
      if command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
        sudo -n find -P "${path}" -xdev -type d -exec chown -h "$(id -u):$(id -g)" {} + ||
          echo "::warning::Could not reclaim directory ownership under ${path}; retrying chmod without ownership repair."
        find -P "${path}" -xdev -type d -exec chmod u+rwx {} + ||
          echo "::warning::Could not restore user directory write bits under ${path} after reclaiming ownership; cleanup may fail if stale directories remain locked down."
      else
        echo "::warning::Could not restore user directory write bits under ${path}; cleanup may fail if stale directories remain locked down."
      fi
    fi
  done
}
restore_workspace_write_bits() {
  if command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
    sudo -n find -P . -xdev -path ./.git -prune -o -type d -exec chown -h "$(id -u):$(id -g)" {} +
  fi
  find -P . -xdev -path ./.git -prune -o -type d -exec chmod u+rwx {} +
}

if ! git reset --hard HEAD; then
  echo "::warning::git reset --hard failed; reclaiming workspace write bits and retrying once."
  restore_workspace_write_bits ||
    echo "::warning::Could not restore workspace write bits completely; retrying git reset with the repaired subset."
  git reset --hard HEAD
fi
excludes=()
# Trust-gate: a fork pull request is the only untrusted case.
# `HEAD_REPO` is non-empty only on `pull_request` events; a
# mismatch with `BASE_REPO` means the PR came from a fork. Every
# other event (push, schedule, workflow_dispatch,
# pull_request_target, same-repo pull_request, future events like
# merge_group) is trusted and preserves `node_modules` only when
# PRESERVE_NODE_MODULES is true, plus
# `extra-keep` so self-hosted installs can relink from the local
# pnpm store without downloading packages again. Fork PRs get a full clean so
# an untrusted contributor cannot leave modified package binaries
# that a later trusted run executes via `pnpm exec` with elevated
# permissions.
# Note: in reusable workflows triggered via `workflow_call`,
# `github.event_name` evaluates against the *caller's* event — so
# the trust-gate applies uniformly to direct and reusable workflows.
is_fork_pr=false
if [ "${EVENT_NAME}" = "pull_request" ] && {
  [ -z "${HEAD_REPO}" ] || [ "${HEAD_REPO}" != "${BASE_REPO}" ]
}; then
  is_fork_pr=true
fi
is_dependabot_pr=false
if [ "${EVENT_NAME}" = "pull_request" ] && [ "${PR_AUTHOR:-}" = "dependabot[bot]" ]; then
  is_dependabot_pr=true
fi
# Contamination sentinel: fork PRs share the persistent runner's
# workspace with subsequent trusted jobs. A fork PR's code runs
# after the initial full clean and can replace binaries in
# node_modules. The sentinel (written outside the workspace so
# git clean cannot remove it) tells the next run to force-clean
# regardless of its trust level, then removes itself. Keyed on the
# workspace path so multiple repos on the same runner don't
# interfere.
_ws_key="$(printf '%s' "${GITHUB_WORKSPACE:-$(pwd)}" | tr -cd 'A-Za-z0-9' | tail -c 40)"
SENTINEL="${RUNNER_TOOL_CACHE:-${HOME}}/.cw-fork-pr-${_ws_key}"
if [ -f "${SENTINEL}" ]; then
  rm -f "${SENTINEL}"
  is_fork_pr=true
fi
if [ "${is_fork_pr}" = "false" ] && [ "${is_dependabot_pr}" = "false" ]; then
  if [ "${PRESERVE_NODE_MODULES:-true}" = "true" ]; then
    excludes+=(-e node_modules)
  fi
  excludes+=(-e .cache)
  if [ -n "${EXTRA_KEEP}" ]; then
    # Disable globbing so patterns like `dist/*` are passed literally
    # to `git clean -e` rather than being expanded by the shell
    # against the current working tree.
    set -f
    for pattern in ${EXTRA_KEEP}; do
      excludes+=(-e "${pattern}")
    done
    set +f
  fi
fi
generated_repair_paths=()
if [ -n "${RUNNER_TEMP:-}" ]; then
  generated_repair_paths+=("${RUNNER_TEMP}/wrangler-logs")
fi
if [ -n "${GENERATED_REPAIR_PATHS}" ]; then
  set -f
  for pattern in ${GENERATED_REPAIR_PATHS}; do
    generated_repair_paths+=("${pattern}")
  done
  set +f
fi
while IFS= read -r path; do
  generated_repair_paths+=("${path}")
done < <(find -P . -xdev -path ./.git -prune -o -type d -name node_modules -print -prune)
if [ "${#generated_repair_paths[@]}" -gt 0 ]; then
  restore_user_directory_write_bits "${generated_repair_paths[@]}"
fi
# Bash 3.2 on macOS treats an empty array expansion as unbound under
# `set -u`; use the safe expansion form so fork-PR runs can
# full-clean with no excludes.
if ! git clean -ffdx "${excludes[@]+"${excludes[@]}"}"; then
  echo "::warning::git clean failed after targeted repair; reclaiming workspace write bits and retrying once."
  restore_workspace_write_bits ||
    echo "::warning::Could not restore workspace write bits completely; retrying git clean with the repaired subset."
  git clean -ffdx "${excludes[@]+"${excludes[@]}"}"
fi
# Runs that preserve node_modules retain them for install speed.
# Drop TypeScript incremental build info inside those preserved trees
# so stale virtual-store paths do not survive dependency graph changes.
while IFS= read -r cache_dir; do
  rm -rf "${cache_dir}/tsbuildinfo"* "${cache_dir}"/*.tsbuildinfo
done < <(find -P . -xdev -path ./.git -prune -o -type d -path '*/node_modules/.cache' -print 2>/dev/null || true)
# Write the sentinel after the fork PR's full clean. The next run on
# this persistent runner will see it, force-clean, and remove it. Use
# the raw event test (not the sentinel-overridden is_fork_pr) so a
# trusted job that consumed the sentinel does not re-write it.
if [ "${EVENT_NAME}" = "pull_request" ] && {
  [ -z "${HEAD_REPO}" ] || [ "${HEAD_REPO}" != "${BASE_REPO}" ]
}; then
  touch "${SENTINEL}" || echo "::warning::Could not write contamination sentinel to ${SENTINEL}; the next trusted run on this persistent runner may not force-clean node_modules."
fi
if [ "${DEEPEN}" = "true" ]; then
  # Self-hosted runners occasionally see transient libcurl Recv
  # failures or stuck git-remote-https children against github.com.
  # Bound each fetch attempt so the retry loop gets control back
  # before the composite action's step timeout kills the whole step.
  fetch_git_config=(-c http.lowSpeedLimit=1000 -c http.lowSpeedTime=30)
  if [ -n "${GITHUB_TOKEN:-}" ]; then
    fetch_git_config+=(
      -c 'credential.helper=!f() { printf "username=x-access-token\npassword=%s\n" "${GITHUB_TOKEN}"; }; f'
    )
  fi
  git_fetch_once() {
    case " $* " in
      *" --unshallow "*)
        git "${fetch_git_config[@]}" fetch "$@"
        return $?
        ;;
    esac
    local timeout_seconds=25
    if command -v timeout >/dev/null 2>&1; then
      timeout --kill-after=5s "${timeout_seconds}s" git "${fetch_git_config[@]}" fetch "$@"
      return $?
    fi
    if command -v perl >/dev/null 2>&1; then
      perl -e 'my $t = shift @ARGV; my $pid = fork(); if (!defined $pid) { exit 125; } if ($pid == 0) { setpgrp(0, 0); exec @ARGV; exit 127; } local $SIG{ALRM} = sub { kill(15, -$pid); for (1..50) { last if waitpid($pid, 1) == $pid; select undef, undef, undef, 0.1; } kill(9, -$pid); exit 124; }; alarm $t; waitpid($pid, 0); my $status = $?; exit($status & 127 ? 128 + ($status & 127) : $status >> 8);' "${timeout_seconds}" git "${fetch_git_config[@]}" fetch "$@"
      return $?
    fi
    git "${fetch_git_config[@]}" fetch "$@"
  }
  git_fetch_with_retry() {
    local attempt
    for attempt in 1 2 3; do
      local status
      if git_fetch_once "$@"; then
        return 0
      else
        status=$?
      fi
      if [ "${status}" -eq 124 ] || [ "${status}" -eq 137 ]; then
        echo "::warning::git fetch $* timed out on attempt ${attempt}"
      fi
      if [ "${attempt}" -lt 3 ]; then
        local delay=5
        [ "${attempt}" -eq 2 ] && delay=15
        echo "::warning::git fetch $* failed on attempt ${attempt}; retrying in ${delay}s"
        sleep "${delay}"
      fi
    done
    echo "::warning::git fetch $* failed after 3 attempts"
    return 1
  }
  if [ "$(git rev-parse --is-shallow-repository)" = "true" ]; then
    if ! git_fetch_with_retry --unshallow --no-tags origin; then
      echo "::warning::git fetch --unshallow exhausted retries; falling back to a regular fetch"
      git_fetch_with_retry --no-tags --prune origin
      if [ "$(git rev-parse --is-shallow-repository)" = "true" ]; then
        echo "::error::Repository is still shallow after fallback fetch. Downstream git diff operations may produce incomplete results."
        exit 1
      fi
    fi
  fi
  git_fetch_with_retry --no-tags origin "+refs/heads/${BASE_REF}:refs/remotes/origin/${BASE_REF}"
fi
