#!/usr/bin/env bash

set -u

have() {
  command -v "$1" >/dev/null 2>&1
}

section() {
  printf '\n== %s ==\n' "$1"
}

show_meminfo_field() {
  field=$1
  if [ -r /proc/meminfo ]; then
    awk -v name="$field" '$1 == name ":" { print }' /proc/meminfo 2>/dev/null || true
  fi
}

show_oom_lines() {
  lines=''
  attempted=false

  # Never retain a complete kernel log in memory. Each source gets two seconds,
  # then the filtered result is capped at 50 lines of 1,000 characters.
  if have timeout && have journalctl; then
    attempted=true
    lines=$(
      timeout 2 journalctl -k --since '30 min ago' --no-pager 2>/dev/null |
        grep -Ei 'oom|oom-kill|out of memory|killed process' |
        cut -c 1-1000 |
        tail -n 50 || true
    )
  fi

  if [ -z "$lines" ] && have timeout && have dmesg; then
    attempted=true
    lines=$(
      timeout 2 dmesg 2>/dev/null |
        grep -Ei 'oom|oom-kill|out of memory|killed process' |
        cut -c 1-1000 |
        tail -n 50 || true
    )
  fi

  if [ -n "$lines" ]; then
    printf '%s\n' "$lines"
  elif [ "$attempted" = false ]; then
    printf 'unavailable: bounded kernel-log reader or source command missing\n'
  else
    printf 'no OOM-kill lines found within bounded reads\n'
  fi
}

show_top_rss_processes() {
  if have ps && have sort && have sed; then
    ps ax -o pid= -o rss= -o comm= 2>/dev/null | sort -k2,2nr | sed -n '1,15p'
  else
    printf 'unavailable\n'
  fi
}

show_runner_counts() {
  ps ax -o comm= 2>/dev/null | awk '
    {
      command = $0
      sub(/^[[:space:]]+/, "", command)
      sub(/[[:space:]]+$/, "", command)
      sub(/^.*\//, "", command)
      if (command == "Runner.Worker") workers++
      else if (command == "Runner.Listener") listeners++
    }
    END {
      printf "Runner.Worker count: %d\n", workers + 0
      printf "Runner.Listener count: %d\n", listeners + 0
    }
  '
}

show_cgroup_memory() {
  found=false
  relative_cgroup=$(awk -F: '$1 == "0" { print $3; exit }' /proc/self/cgroup 2>/dev/null || true)
  case "$relative_cgroup" in
    /*) current_cgroup_root=/sys/fs/cgroup$relative_cgroup ;;
    *) current_cgroup_root=/sys/fs/cgroup ;;
  esac

  for cgroup_root in "$current_cgroup_root" /sys/fs/cgroup; do
    for field in memory.current memory.max memory.events memory.events.local; do
      path=$cgroup_root/$field
      if [ -r "$path" ]; then
        found=true
        printf '%s:\n' "$path"
        cat "$path" 2>/dev/null || printf 'unavailable\n'
      fi
    done
    [ "$cgroup_root" = /sys/fs/cgroup ] && break
  done
  [ "$found" = true ] || printf 'unavailable\n'
}

platform=$(uname -s 2>/dev/null || printf 'unknown')

section 'host pressure diagnostics'
printf 'platform: %s\n' "$platform"

case "$platform" in
  Linux)
    section 'memory and swap basics'
    if have free; then
      free -h 2>/dev/null || printf 'free unavailable\n'
    else
      printf 'free unavailable\n'
    fi

    section '/proc/meminfo selected fields'
    show_meminfo_field MemTotal
    show_meminfo_field MemFree
    show_meminfo_field MemAvailable
    show_meminfo_field Buffers
    show_meminfo_field Cached
    show_meminfo_field SwapTotal
    show_meminfo_field SwapFree
    show_meminfo_field SwapCached

    section 'cgroup memory'
    show_cgroup_memory

    section 'pressure stall information'
    for path in /proc/pressure/memory /proc/pressure/cpu /proc/pressure/io; do
      if [ -r "$path" ]; then
        printf '%s:\n' "$path"
        cat "$path" 2>/dev/null || printf 'unavailable\n'
      else
        printf '%s unavailable\n' "$path"
      fi
    done

    section 'load and cpu'
    if [ -r /proc/loadavg ]; then
      printf 'load average: '
      awk '{ print $1, $2, $3 }' /proc/loadavg 2>/dev/null || printf 'unavailable\n'
    else
      printf 'load average unavailable\n'
    fi
    printf 'nproc: '
    if have nproc; then
      nproc 2>/dev/null || printf 'unavailable\n'
    else
      getconf _NPROCESSORS_ONLN 2>/dev/null || printf 'unavailable\n'
    fi

    section 'kernel OOM evidence'
    show_oom_lines
    section 'top rss processes'
    show_top_rss_processes
    section 'runner worker/listener counts'
    show_runner_counts
    ;;
  Darwin)
    section 'system basics'
    uptime 2>/dev/null || printf 'uptime unavailable\n'
    printf 'hw.ncpu: '
    sysctl -n hw.ncpu 2>/dev/null || printf 'unavailable\n'
    printf 'hw.memsize: '
    sysctl -n hw.memsize 2>/dev/null || printf 'unavailable\n'
    section 'swap and vm'
    vm_stat 2>/dev/null || printf 'vm_stat unavailable\n'
    sysctl vm.swapusage 2>/dev/null || printf 'vm.swapusage unavailable\n'
    section 'top rss processes'
    show_top_rss_processes
    section 'runner worker/listener counts'
    show_runner_counts
    ;;
  *)
    section 'system basics'
    printf 'unsupported platform: %s\n' "$platform"
    ;;
esac
