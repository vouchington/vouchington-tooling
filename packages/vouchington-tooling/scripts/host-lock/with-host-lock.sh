#!/usr/bin/env bash

set -u

usage() {
  echo 'usage: with-host-lock.sh --name <family> [--slots <positive-int>] --timeout-seconds <positive-int> [--command-timeout-seconds <nonnegative-int>] [--failure-diagnostics <absolute-script-path>] [--on-acquire-timeout fail|run-unlocked] -- <command> [args...]' >&2
}

fail() {
  echo "with-host-lock: $1" >&2
  exit 2
}

[ -z "${HOST_LOCK_ACTIVE:-}" ] || fail 'nested host locks are not allowed'

name=''
slot_count=1
slots_explicit=0
timeout_seconds=''
command_timeout_seconds=0
failure_diagnostics=''
on_acquire_timeout=fail
process_group_drain_seconds=${HOST_LOCK_PROCESS_GROUP_DRAIN_SECONDS:-30}
lease_seconds=${HOST_LOCK_LEASE_SECONDS:-60}

case "$process_group_drain_seconds" in
  '' | *[!0-9]*) fail 'HOST_LOCK_PROCESS_GROUP_DRAIN_SECONDS must be a nonnegative integer' ;;
esac

case "$lease_seconds" in
  '' | *[!0-9]*) fail 'HOST_LOCK_LEASE_SECONDS must be a positive integer of at least 4' ;;
esac
[ "$lease_seconds" -ge 4 ] || fail 'HOST_LOCK_LEASE_SECONDS must be a positive integer of at least 4'
# Refresh at a quarter of the lease so three consecutive missed refreshes still
# precede expiry; the margin survives any change to the lease.
lease_refresh_seconds=$((lease_seconds / 4))

while [ "$#" -gt 0 ]; do
  case "$1" in
    --name)
      [ "$#" -ge 2 ] || fail '--name requires a lock family name'
      name=$2
      shift 2
      ;;
    --slots)
      [ "$#" -ge 2 ] || fail '--slots requires a positive integer'
      slot_count=$2
      slots_explicit=1
      shift 2
      ;;
    --timeout-seconds)
      [ "$#" -ge 2 ] || fail '--timeout-seconds requires a positive integer'
      timeout_seconds=$2
      shift 2
      ;;
    --command-timeout-seconds)
      [ "$#" -ge 2 ] || fail '--command-timeout-seconds requires a nonnegative integer'
      command_timeout_seconds=$2
      shift 2
      ;;
    --failure-diagnostics)
      [ "$#" -ge 2 ] || fail '--failure-diagnostics requires an absolute script path'
      failure_diagnostics=$2
      shift 2
      ;;
    --on-acquire-timeout)
      [ "$#" -ge 2 ] || fail "--on-acquire-timeout requires 'fail' or 'run-unlocked'"
      on_acquire_timeout=$2
      shift 2
      ;;
    --)
      shift
      break
      ;;
    *)
      usage
      fail "unknown argument: $1"
      ;;
  esac
done

[ -n "$name" ] || {
  usage
  fail 'missing --name'
}
case "$name" in
  *[!A-Za-z0-9._-]* | '' | [.-]*) fail "invalid lock family name: $name" ;;
esac

case "$slot_count" in
  '' | *[!0-9]* | 0) fail '--slots must be a positive integer' ;;
esac

case "$timeout_seconds" in
  '' | *[!0-9]* | 0) fail '--timeout-seconds must be a positive integer' ;;
esac

case "$command_timeout_seconds" in
  '' | *[!0-9]*) fail '--command-timeout-seconds must be a nonnegative integer' ;;
esac

case "$failure_diagnostics" in
  '') ;;
  /*) ;;
  *) fail '--failure-diagnostics must be an absolute script path' ;;
esac

case "$on_acquire_timeout" in
  fail | run-unlocked) ;;
  *) fail "--on-acquire-timeout must be 'fail' or 'run-unlocked'" ;;
esac

[ "$#" -gt 0 ] || {
  usage
  fail 'missing command after --'
}

run_failure_diagnostics() {
  [ -n "$failure_diagnostics" ] || return 0
  bash "$failure_diagnostics" || true
}

lock_root=${HOST_LOCK_ROOT:-/tmp/host-lock-$UID}
case "$lock_root" in
  /*) ;;
  *) fail 'HOST_LOCK_ROOT must be an absolute path' ;;
esac
selected_name=$name
lock_dir=''
reap_dir=''

select_slot() {
  slot_number=$1
  if [ "$slots_explicit" -eq 0 ]; then
    selected_name=$name
  else
    selected_name=$name-slot-$slot_number
  fi
  lock_dir=$lock_root/$selected_name.lock.d
  reap_dir=$lock_root/$selected_name.lock.reap.d
}

[ ! -L "$lock_root" ] || fail "lock root must not be a symbolic link: $lock_root"
old_umask=$(umask)
umask 077
mkdir -p "$lock_root" || fail "cannot create lock root: $lock_root"
umask "$old_umask"
[ ! -L "$lock_root" ] || fail "lock root must not be a symbolic link: $lock_root"
lock_root_uid=$(stat -f '%u' "$lock_root" 2>/dev/null) ||
  lock_root_uid=$(stat -c '%u' "$lock_root" 2>/dev/null) ||
  fail "cannot inspect lock root ownership: $lock_root"
[ "$lock_root_uid" = "$UID" ] || fail "lock root is not owned by uid $UID: $lock_root"
chmod 700 "$lock_root" || fail "cannot make lock root private: $lock_root"

process_is_live() {
  candidate_pid=$1
  candidate_kill_error=$(kill -0 "$candidate_pid" 2>&1) && return 0
  case "$candidate_kill_error" in
    *[Oo]peration*not*permitted* | *[Pp]ermission*denied*) return 0 ;;
  esac
  ps -p "$candidate_pid" -o pid= 2>/dev/null | awk 'NF { found = 1 } END { exit !found }'
}

process_group_is_live() {
  candidate_pgid=$1
  candidate_kill_error=$(kill -0 -- "-$candidate_pgid" 2>&1) && return 0
  case "$candidate_kill_error" in
    *[Oo]peration*not*permitted* | *[Pp]ermission*denied*) return 0 ;;
  esac
  ps -e -o pgid= 2>/dev/null |
    awk -v candidate_pgid="$candidate_pgid" '$1 == candidate_pgid { found = 1; exit } END { exit !found }'
}

directory_mtime() {
  directory=$1
  mtime=$(stat -f '%m' "$directory" 2>/dev/null) ||
    mtime=$(stat -c '%Y' "$directory" 2>/dev/null) || return 1
  case "$mtime" in
    '' | *[!0-9]*) return 1 ;;
  esac
  printf '%s\n' "$mtime"
}

owned_directory_is_stale() {
  owned_directory=$1
  ownerless_grace_seconds=$2
  valid_owner_metadata=0
  if [ -f "$owned_directory/owner.pid" ] || [ -f "$owned_directory/owner.pgid" ]; then
    recorded_pid=$(sed -n '1p' "$owned_directory/owner.pid" 2>/dev/null || true)
    case "$recorded_pid" in
      '' | *[!0-9]*) ;;
      *)
        valid_owner_metadata=1
        process_is_live "$recorded_pid" && return 1
        ;;
    esac
    recorded_pgid=$(sed -n '1p' "$owned_directory/owner.pgid" 2>/dev/null || true)
    case "$recorded_pgid" in
      '' | *[!0-9]*) ;;
      *)
        valid_owner_metadata=1
        process_group_is_live "$recorded_pgid" && return 1
        ;;
    esac
    [ "$valid_owner_metadata" -eq 0 ] || return 0
  fi

  mtime=$(directory_mtime "$owned_directory") || return 1
  now=$(date +%s)
  [ $((now - mtime)) -gt "$ownerless_grace_seconds" ]
}

reaper_owner_pid=''
reaper_owner_token=''

owns_reaper() {
  current_reaper_pid=$(sed -n '1p' "$reap_dir/owner.pid" 2>/dev/null || true)
  current_reaper_token=$(sed -n '1p' "$reap_dir/owner.token" 2>/dev/null || true)
  [ "$current_reaper_pid" = "$reaper_owner_pid" ] &&
    [ "$current_reaper_token" = "$reaper_owner_token" ]
}

cleanup_reaper() {
  if [ -n "$reaper_owner_token" ] && owns_reaper; then
    rm -rf "$reap_dir"
  fi
  reaper_owner_pid=''
  reaper_owner_token=''
}

recover_stale_reaper() {
  [ -d "$reap_dir" ] || return 0
  stale_reaper_pid=$(sed -n '1p' "$reap_dir/owner.pid" 2>/dev/null || true)
  stale_reaper_token=$(sed -n '1p' "$reap_dir/owner.token" 2>/dev/null || true)
  owned_directory_is_stale "$reap_dir" 10 || return 1

  current_reaper_pid=$(sed -n '1p' "$reap_dir/owner.pid" 2>/dev/null || true)
  current_reaper_token=$(sed -n '1p' "$reap_dir/owner.token" 2>/dev/null || true)
  if [ "$current_reaper_pid" = "$stale_reaper_pid" ] &&
    [ "$current_reaper_token" = "$stale_reaper_token" ]; then
    rm -rf "$reap_dir"
  fi
}

# Owner liveness may only accelerate reclamation, never delay it past the lease:
# owned_directory_is_stale reclaims a provably-dead or metadata-less owner
# immediately, and the mtime check below is an unconditional ceiling regardless
# of what the owner metadata claims. This is what recovers a crash that killed
# the wrapper between `mkdir "$lock_dir"` and the owner.pid/owner.token writes
# (dead-but-valid metadata reclaims immediately; ownerless metadata otherwise
# would not) and a live-but-stale holder whose PID has been reused by the OS.
lock_is_reclaimable() {
  owned_directory_is_stale "$lock_dir" "$lease_seconds" && return 0
  mtime=$(directory_mtime "$lock_dir") || return 1
  [ $(($(date +%s) - mtime)) -gt "$lease_seconds" ]
}

reclaim_stale_lock() {
  recover_stale_reaper || true
  mkdir "$reap_dir" 2>/dev/null || return 1
  reaper_owner_pid=$$
  reaper_owner_token="reaper-$$-$(date +%s)-$RANDOM"
  printf '%s\n' "$reaper_owner_pid" >"$reap_dir/owner.pid"
  printf '%s\n' "$reaper_owner_token" >"$reap_dir/owner.token"

  if [ -d "$lock_dir" ] && lock_is_reclaimable && owns_reaper; then
    rm -rf "$lock_dir"
  fi
  cleanup_reaper
}

try_acquire_selected_slot() {
  [ ! -d "$reap_dir" ] || return 1
  mkdir "$lock_dir" 2>/dev/null || return 1
  acquired=1
}

report_acquire_timeout_owners() {
  waited_seconds=$(($(date +%s) - start_time))
  slot_number=1
  while [ "$slot_number" -le "$slot_count" ]; do
    select_slot "$slot_number"
    recorded_pid=$(sed -n '1p' "$lock_dir/owner.pid" 2>/dev/null || true)
    recorded_pgid=$(sed -n '1p' "$lock_dir/owner.pgid" 2>/dev/null || true)
    case "$recorded_pid" in
      '' | *[!0-9]*) recorded_pid=missing ;;
    esac
    case "$recorded_pgid" in
      '' | *[!0-9]*) recorded_pgid=missing ;;
    esac
    echo "with-host-lock: $name waited ${waited_seconds}s; $selected_name owner pid=$recorded_pid pgid=$recorded_pgid" >&2
    slot_number=$((slot_number + 1))
  done
}

start_time=$(date +%s)
deadline=$((start_time + timeout_seconds))
acquired=0

while :; do
  slot_number=1
  while [ "$slot_number" -le "$slot_count" ]; do
    select_slot "$slot_number"
    try_acquire_selected_slot && break
    reclaim_stale_lock || true
    try_acquire_selected_slot && break
    slot_number=$((slot_number + 1))
  done
  [ "$acquired" -eq 0 ] || break

  now=$(date +%s)
  if [ "$now" -ge "$deadline" ]; then
    if [ "$on_acquire_timeout" = 'run-unlocked' ]; then
      echo "with-host-lock: $name lock not acquired within ${timeout_seconds}s; running unlocked" >&2
      report_acquire_timeout_owners
      break
    fi
    echo "with-host-lock: $name lock not acquired within ${timeout_seconds}s" >&2
    report_acquire_timeout_owners
    run_failure_diagnostics
    exit 1
  fi
  remaining_seconds=$((deadline - now))
  sleep_seconds=2
  if [ "$remaining_seconds" -lt "$sleep_seconds" ]; then
    sleep_seconds=$remaining_seconds
  fi
  [ "$sleep_seconds" -gt 0 ] && sleep "$sleep_seconds"
done

owner_pid=$$
owner_token=''
temporary_start_release=''
if [ "$acquired" -eq 1 ]; then
  owner_token="$$-$(date +%s)-$RANDOM"
  printf '%s\n' "$owner_pid" >"$lock_dir/owner.pid"
  printf '%s\n' "$owner_token" >"$lock_dir/owner.token"
  waited_seconds=$(($(date +%s) - start_time))
  echo "with-host-lock: $name acquired after ${waited_seconds}s" >&2
fi

cleanup_lock() {
  stop_lease_heartbeat
  if [ -n "$temporary_start_release" ]; then
    rm -f "$temporary_start_release" 2>/dev/null || true
    temporary_start_release=''
  fi
  [ "$acquired" -eq 1 ] || return 0
  current_pid=$(sed -n '1p' "$lock_dir/owner.pid" 2>/dev/null || true)
  current_token=$(sed -n '1p' "$lock_dir/owner.token" 2>/dev/null || true)
  if [ "$current_pid" = "$owner_pid" ] && [ "$current_token" = "$owner_token" ]; then
    rm -rf "$lock_dir"
  fi
  acquired=0
}

child_pid=''
signal_forwarded=0
pending_signal=''
watchdog_pid=''
command_timeout_marker=''
lease_heartbeat_pid=''

# shellcheck disable=SC2329 # Invoked by the INT and TERM traps below.
forward_signal() {
  pending_signal=$1
  if [ -n "$child_pid" ]; then
    kill -s "$pending_signal" -- "-$child_pid" 2>/dev/null || true
  fi
}

wait_for_process_group_until() {
  deadline=$1
  while process_group_is_live "$child_pid"; do
    [ "$(date +%s)" -lt "$deadline" ] || return 1
    sleep 0.1
  done
}

# Escalates TERM then KILL against the command's process group, giving it up to
# grace_seconds to drain at each step. Shared by the post-command drain below and
# by the command-timeout watchdog, so there is exactly one kill/verify sequence.
terminate_process_group() {
  grace_seconds=$1
  kill -s TERM -- "-$child_pid" 2>/dev/null || true
  term_deadline=$(($(date +%s) + grace_seconds))
  wait_for_process_group_until "$term_deadline" && return 0
  kill -s KILL -- "-$child_pid" 2>/dev/null || true
  kill_deadline=$(($(date +%s) + grace_seconds))
  wait_for_process_group_until "$kill_deadline"
}

start_command_timeout_watchdog() {
  [ "$command_timeout_seconds" -gt 0 ] || return 0
  # Create a unique marker filename without leaving a file behind — the
  # watchdog recreates it via : > only when the timeout actually fires.
  command_timeout_marker=$(mktemp "${TMPDIR:-/tmp}/with-host-lock-timeout.XXXXXX") ||
    fail 'cannot create command-timeout marker file'
  rm -f "$command_timeout_marker"
  set -m
  (
    sleep "$command_timeout_seconds"
    if kill -0 "$child_pid" 2>/dev/null; then
      : >"$command_timeout_marker"
      echo "with-host-lock: $name command exceeded ${command_timeout_seconds}s; terminating its process group" >&2
      terminate_process_group 5 || true
    fi
  ) &
  watchdog_pid=$!
  set +m
}

stop_command_timeout_watchdog() {
  [ -n "$watchdog_pid" ] || return 0
  kill -s KILL -- "-$watchdog_pid" 2>/dev/null || true
  wait "$watchdog_pid" 2>/dev/null || true
  watchdog_pid=''
}

# Keeps the held lock directory's mtime within the reclamation lease while this
# wrapper owns it. Re-reads the lock metadata every tick (rather than trusting a
# snapshot) so it stops touching as soon as the lock is reclaimed, handed to a
# replacement owner, or its recorded owner dies — an orphaned heartbeat must let
# the lease lapse, not hold it open forever.
#
# Closes its own stdout/stderr instead of inheriting the wrapper's: a SIGKILL of
# the wrapper cannot run the EXIT trap that would otherwise stop this subshell,
# so it can outlive the wrapper as an orphan. An orphan that still held the
# wrapper's piped stdout/stderr open would wedge any caller waiting on those
# pipes to reach EOF (e.g. a `child_process` "close" event) until the command it
# is heartbeating for eventually exits too.
start_lease_heartbeat() {
  [ "$acquired" -eq 1 ] || return 0
  set -m
  (
    while sleep "$lease_refresh_seconds"; do
      current_token=$(sed -n '1p' "$lock_dir/owner.token" 2>/dev/null || true)
      [ "$current_token" = "$owner_token" ] || exit 0
      current_pid=$(sed -n '1p' "$lock_dir/owner.pid" 2>/dev/null || true)
      current_pgid=$(sed -n '1p' "$lock_dir/owner.pgid" 2>/dev/null || true)
      owner_live=0
      case "$current_pid" in
        '' | *[!0-9]*) ;;
        *) process_is_live "$current_pid" && owner_live=1 ;;
      esac
      case "$current_pgid" in
        '' | *[!0-9]*) ;;
        *) process_group_is_live "$current_pgid" && owner_live=1 ;;
      esac
      [ "$owner_live" -eq 1 ] || exit 0
      touch "$lock_dir" 2>/dev/null || exit 0
    done
  ) </dev/null >/dev/null 2>&1 &
  lease_heartbeat_pid=$!
  set +m
}

stop_lease_heartbeat() {
  [ -n "$lease_heartbeat_pid" ] || return 0
  kill -s KILL -- "-$lease_heartbeat_pid" 2>/dev/null || true
  wait "$lease_heartbeat_pid" 2>/dev/null || true
  lease_heartbeat_pid=''
}

trap cleanup_lock EXIT
trap 'signal_forwarded=1; forward_signal INT' INT
trap 'signal_forwarded=1; forward_signal TERM' TERM

if [ "$acquired" -eq 1 ]; then
  start_release=$lock_dir/start.release
else
  start_release=$(mktemp "${TMPDIR:-/tmp}/with-host-lock-release.XXXXXX") ||
    fail 'cannot create release marker file'
  temporary_start_release=$start_release
fi

export HOST_LOCK_ACTIVE=1

# Job control keeps an asynchronous command's SIGINT disposition intact. Without
# it, non-interactive Bash starts background commands with SIGINT ignored.
set -m
bash -c '
  wrapper_pid=$1
  start_release=$2
  shift 2
  while [ ! -f "$start_release" ]; do
    kill -0 "$wrapper_pid" 2>/dev/null || exit 1
    sleep 0.05
  done
  exec "$@"
' with-host-lock-child "$$" "$start_release" "$@" &
child_pid=$!
if [ "$acquired" -eq 1 ]; then
  owner_pid=$child_pid
  printf '%s\n' "$owner_pid" >"$lock_dir/owner.pid"
  printf '%s\n' "$child_pid" >"$lock_dir/owner.pgid"
fi
: >"$start_release"
if [ -n "$pending_signal" ]; then
  kill -s "$pending_signal" -- "-$child_pid" 2>/dev/null || true
fi
set +m

start_command_timeout_watchdog
start_lease_heartbeat

while :; do
  signal_forwarded=0
  wait "$child_pid"
  status=$?
  if [ "$signal_forwarded" -eq 0 ] || ! kill -0 "$child_pid" 2>/dev/null; then
    break
  fi
done

stop_command_timeout_watchdog

process_group_drain_deadline=$(($(date +%s) + process_group_drain_seconds))
if ! wait_for_process_group_until "$process_group_drain_deadline"; then
  echo "with-host-lock: $name command left processes running; terminating its process group" >&2
  if ! terminate_process_group 5; then
    echo "with-host-lock: $name process group survived SIGKILL; retaining lock ownership" >&2
    acquired=0
    exit 1
  fi
fi

if [ -n "$command_timeout_marker" ] && [ -f "$command_timeout_marker" ]; then
  status=124
fi
if [ "$status" -ne 0 ]; then
  run_failure_diagnostics
fi
[ -z "$command_timeout_marker" ] || rm -f "$command_timeout_marker" 2>/dev/null || true
cleanup_lock
trap - EXIT INT TERM
exit "$status"
