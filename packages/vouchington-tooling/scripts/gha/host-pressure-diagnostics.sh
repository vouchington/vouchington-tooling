#!/usr/bin/env bash

set -u

have() {
  command -v "$1" >/dev/null 2>&1
}

section() {
  printf '\n== %s ==\n' "$1"
}

is_number() {
  case "$1" in
    '' | *[!0-9.]*) return 1 ;;
    *) return 0 ;;
  esac
}

show_load_per_cpu() {
  load1=$1
  load5=$2
  load15=$3
  cpu_count=$4
  printf 'load average: %s %s %s\n' "${load1:-unavailable}" "${load5:-unavailable}" "${load15:-unavailable}"
  if is_number "$load1" && is_number "$cpu_count" && [ "$cpu_count" != '0' ]; then
    awk -v load="$load1" -v cpus="$cpu_count" 'BEGIN { printf "load1 per cpu: %.2f\n", load / cpus }'
  else
    printf 'load1 per cpu: unavailable\n'
  fi
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
    output=$(ps ax -o pid= -o rss= -o comm= 2>/dev/null | sort -k2,2nr | sed -n '1,15p')
  else
    output=''
  fi
  if [ -n "$output" ]; then
    printf '%s\n' "$output"
  else
    printf 'unavailable: top rss processes\n'
  fi
}

show_runner_counts() {
  process_list=$(ps ax -o comm= 2>/dev/null)
  if [ -z "$process_list" ]; then
    printf 'unavailable: process list\n'
    return
  fi
  printf '%s\n' "$process_list" | awk '
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
    loadavg_line=''
    if [ -r /proc/loadavg ]; then
      loadavg_line=$(awk '{ print $1, $2, $3 }' /proc/loadavg 2>/dev/null || true)
    fi
    load1=$(printf '%s' "$loadavg_line" | awk '{ print $1 }')
    load5=$(printf '%s' "$loadavg_line" | awk '{ print $2 }')
    load15=$(printf '%s' "$loadavg_line" | awk '{ print $3 }')
    printf 'nproc: '
    if have nproc; then
      cpu_count=$(nproc 2>/dev/null || true)
    else
      cpu_count=$(getconf _NPROCESSORS_ONLN 2>/dev/null || true)
    fi
    printf '%s\n' "${cpu_count:-unavailable}"
    show_load_per_cpu "$load1" "$load5" "$load15" "$cpu_count"

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
    printf 'hw.memsize: '
    sysctl -n hw.memsize 2>/dev/null || printf 'unavailable\n'
    section 'swap and vm'
    vm_stat 2>/dev/null || printf 'vm_stat unavailable\n'
    sysctl vm.swapusage 2>/dev/null || printf 'vm.swapusage unavailable\n'

    section 'load and cpu'
    loadavg_raw=$(sysctl -n vm.loadavg 2>/dev/null || true)
    load1=$(printf '%s' "$loadavg_raw" | awk '{ print $2 }')
    load5=$(printf '%s' "$loadavg_raw" | awk '{ print $3 }')
    load15=$(printf '%s' "$loadavg_raw" | awk '{ print $4 }')
    printf 'hw.logicalcpu: '
    logicalcpu=$(sysctl -n hw.logicalcpu 2>/dev/null || true)
    printf '%s\n' "${logicalcpu:-unavailable}"
    printf 'hw.physicalcpu: '
    sysctl -n hw.physicalcpu 2>/dev/null || printf 'unavailable\n'
    printf 'hw.ncpu: '
    sysctl -n hw.ncpu 2>/dev/null || printf 'unavailable\n'
    show_load_per_cpu "$load1" "$load5" "$load15" "$logicalcpu"
    # Apple-Silicon performance/efficiency core split. These sysctls do not
    # exist on Intel Macs and must degrade to unavailable there.
    printf 'hw.perflevel0.logicalcpu: '
    sysctl -n hw.perflevel0.logicalcpu 2>/dev/null || printf 'unavailable\n'
    printf 'hw.perflevel1.logicalcpu: '
    sysctl -n hw.perflevel1.logicalcpu 2>/dev/null || printf 'unavailable\n'
    # iostat -c 2 is the closest PSI analogue on Darwin: a since-boot row plus
    # a 1-second live row with us/sy/id and 1m/5m/15m load. Do not gate this on
    # `have timeout` -- base macOS ships no timeout binary (only gtimeout via
    # coreutils/Homebrew), and `-c 2` is self-bounding at ~1s regardless.
    if have iostat; then
      if have timeout; then
        timeout 5 iostat -c 2 2>/dev/null || printf 'iostat unavailable\n'
      else
        iostat -c 2 2>/dev/null || printf 'iostat unavailable\n'
      fi
    else
      printf 'iostat unavailable\n'
    fi

    section 'memory pressure'
    if have memory_pressure; then
      memory_pressure -Q 2>/dev/null || printf 'memory_pressure unavailable\n'
    else
      printf 'memory_pressure unavailable\n'
    fi
    printf 'kern.memorystatus_vm_pressure_level: '
    pressure_level=$(sysctl -n kern.memorystatus_vm_pressure_level 2>/dev/null || true)
    case "$pressure_level" in
      1) printf 'normal (1)\n' ;;
      2) printf 'warning (2)\n' ;;
      4) printf 'critical (4)\n' ;;
      '') printf 'unavailable\n' ;;
      *) printf 'unknown (%s)\n' "$pressure_level" ;;
    esac
    printf 'vm.compressor_bytes_used: '
    sysctl -n vm.compressor_bytes_used 2>/dev/null || printf 'unavailable\n'
    # No jetsam/OOM-kill log scrape here (unlike Linux show_oom_lines): `log
    # show` is unbounded and slow, with no cheap bounded equivalent on macOS.

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
