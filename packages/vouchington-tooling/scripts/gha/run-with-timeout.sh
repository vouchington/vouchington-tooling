#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 3 ]; then
  echo "::error::run-with-timeout: timeout runner requires timeout seconds, kill-after seconds, and a command"
  exit 2
fi

timeout_seconds="$1"
kill_after_seconds="$2"
shift 2

case "$timeout_seconds" in
  *[!0-9]* | '0' | '')
    echo "::error::run-with-timeout: timeout seconds must be a positive integer"
    exit 2
    ;;
esac
case "$kill_after_seconds" in
  *[!0-9]* | '0' | '')
    echo "::error::run-with-timeout: kill-after seconds must be a positive integer"
    exit 2
    ;;
esac

if command -v timeout >/dev/null 2>&1 &&
  timeout --version 2>/dev/null | grep -q 'GNU coreutils'; then
  timeout_pid=""
  pending_signal_number=""

  cleanup_timeout_group() {
    [ -n "$timeout_pid" ] || return
    kill -KILL -- "-$timeout_pid" 2>/dev/null || true
  }

  # Invoked through signal traps.
  # shellcheck disable=SC2329
  handle_timeout_signal() {
    signal_number="$1"
    if [ -z "$timeout_pid" ]; then
      pending_signal_number="$signal_number"
      return
    fi
    kill -TERM "$timeout_pid" 2>/dev/null || true
    wait "$timeout_pid" 2>/dev/null || true
    cleanup_timeout_group
    exit $((128 + signal_number))
  }

  trap 'handle_timeout_signal 2' INT
  trap 'handle_timeout_signal 15' TERM
  trap 'handle_timeout_signal 1' HUP

  timeout --kill-after="${kill_after_seconds}s" "${timeout_seconds}s" "$@" &
  timeout_pid=$!
  if [ -n "$pending_signal_number" ]; then
    handle_timeout_signal "$pending_signal_number"
  fi
  if wait "$timeout_pid"; then
    status=0
  else
    status=$?
  fi
  cleanup_timeout_group
  exit "$status"
fi

if command -v perl >/dev/null 2>&1; then
  exec perl -e '
    my $timeout = shift @ARGV;
    my $kill_after = shift @ARGV;
    sub terminate_group {
      my ($pid) = @_;
      kill(15, -$pid);
      for (1 .. ($kill_after * 10)) {
        waitpid($pid, 1);
        return if kill(0, -$pid) == 0;
        select undef, undef, undef, 0.1;
      }
      kill(9, -$pid);
      waitpid($pid, 0);
    }
    my $pid = fork();
    if (!defined $pid) {
      exit 125;
    }
    if ($pid == 0) {
      setpgrp(0, 0);
      exec @ARGV;
      exit 127;
    }
    my $timed_out = 0;
    local $SIG{INT} = sub {
      terminate_group($pid);
      exit 130;
    };
    local $SIG{TERM} = sub {
      terminate_group($pid);
      exit 143;
    };
    local $SIG{HUP} = sub {
      terminate_group($pid);
      exit 129;
    };
    local $SIG{ALRM} = sub {
      $timed_out = 1;
      terminate_group($pid);
    };
    alarm $timeout;
    waitpid($pid, 0);
    my $status = $?;
    alarm 0;
    exit 124 if $timed_out;
    exit($status & 127 ? 128 + ($status & 127) : $status >> 8);
  ' "$timeout_seconds" "$kill_after_seconds" "$@"
fi

echo "::error::run-with-timeout: neither GNU timeout nor Perl is available to enforce the deadline"
exit 125
