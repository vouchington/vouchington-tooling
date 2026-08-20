#!/usr/bin/env bash

PORTS="${PORTS:-}"
OUTPUT_DIR="${OUTPUT_DIR:-${RUNNER_TEMP:-/tmp}/port-diagnostics}"

if [ "${PORT_DIAGNOSTICS_BOUNDED_CHILD:-}" != 1 ]; then
  PORT_DIAGNOSTICS_BOUNDED_CHILD=1 python3 - \
    "${PORT_DIAGNOSTICS_TIMEOUT_SECONDS:-45}" "$0" "$@" <<'PY'
import os
import signal
import subprocess
import sys

try:
    timeout_seconds = float(sys.argv[1])
    if timeout_seconds <= 0 or timeout_seconds > 300:
        raise ValueError
except ValueError:
    timeout_seconds = 45

try:
    process = subprocess.Popen(
        ["bash", sys.argv[2], *sys.argv[3:]],
        env=os.environ.copy(),
        start_new_session=True,
    )
except OSError as error:
    print(f"::warning::Could not start port diagnostics: {error}", file=sys.stderr)
    sys.exit(0)

try:
    process.wait(timeout=timeout_seconds)
except subprocess.TimeoutExpired:
    os.killpg(process.pid, signal.SIGTERM)
    try:
        process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait()
    print(
        f"::warning::Port diagnostics collector exceeded {timeout_seconds:g}s; uploading partial evidence",
        file=sys.stderr,
    )
PY
  exit 0
fi

usage() {
  cat <<'USAGE'
Usage: diagnose-port-collision [--ports "2200 2216"] [--output-dir PATH]

Best-effort, non-masking diagnostics for a failed workflow that allocated localhost ports.
The script never returns a failure for an unavailable probe or an occupied port.
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --ports)
      [ "$#" -ge 2 ] || { usage >&2; exit 0; }
      PORTS="$2"
      shift
      ;;
    --output-dir)
      [ "$#" -ge 2 ] || { usage >&2; exit 0; }
      OUTPUT_DIR="$2"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "::warning::Ignoring unknown diagnostics argument: $1" >&2
      ;;
  esac
  shift
done

if ! mkdir -p "$OUTPUT_DIR" 2>/dev/null; then
  echo "::warning::Could not create port diagnostics directory: $OUTPUT_DIR" >&2
  exit 0
fi

REPORT="$OUTPUT_DIR/summary.txt"
LISTENERS="$OUTPUT_DIR/listeners.txt"
DOCKER_REPORT="$OUTPUT_DIR/docker.txt"
KERNEL_REPORT="$OUTPUT_DIR/kernel.txt"
RUNNER_REPORT="$OUTPUT_DIR/runner.txt"

write_report_header() {
  local path="$1"
  {
    echo "generated_at=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unavailable)"
    echo "workflow=${GITHUB_WORKFLOW:-unavailable}"
    echo "job=${GITHUB_JOB:-unavailable}"
    echo "run_id=${GITHUB_RUN_ID:-unavailable}"
    echo "run_attempt=${GITHUB_RUN_ATTEMPT:-unavailable}"
    echo "runner_name=${RUNNER_NAME:-unavailable}"
    echo "runner_os=${RUNNER_OS:-unavailable}"
    echo "workspace=${GITHUB_WORKSPACE:-unavailable}"
    echo "allocated_ports=${PORTS:-none}"
  } > "$path" 2>/dev/null || true
}

write_report_header "$REPORT"

run_bounded() {
  local seconds="$1"
  shift
  python3 - "$seconds" "$@" <<'PY'
import subprocess
import sys
try:
    subprocess.run(sys.argv[2:], check=False, timeout=float(sys.argv[1]))
except subprocess.TimeoutExpired:
    print(f'probe=timed-out after {sys.argv[1]}s', file=sys.stderr)
except OSError as error:
    print(f'probe=unavailable ({error})', file=sys.stderr)
PY
}

valid_ports=()
invalid_ports=()
read -r -a requested_ports <<< "$PORTS"
for port in "${requested_ports[@]}"; do
  case "$port" in
    ''|*[!0-9]*) invalid_ports+=("$port") ;;
    *)
      if [ "$port" -ge 1 ] && [ "$port" -le 65535 ]; then
        valid_ports+=("$port")
      else
        invalid_ports+=("$port")
      fi
      ;;
  esac
done

{
  echo "requested_port_count=${#requested_ports[@]}"
  echo "valid_port_count=${#valid_ports[@]}"
  echo "invalid_ports=${invalid_ports[*]:-none}"
} >> "$REPORT" 2>/dev/null || true

{
  echo "# Linux kernel port contract (best effort)"
  if command -v sysctl >/dev/null 2>&1; then
    echo "ip_local_reserved_ports=$(sysctl -n net.ipv4.ip_local_reserved_ports 2>/dev/null || echo unavailable)"
    echo "ip_local_port_range=$(sysctl -n net.ipv4.ip_local_port_range 2>/dev/null || echo unavailable)"
  else
    echo "sysctl=unavailable"
  fi
  for path in /proc/sys/net/ipv4/ip_local_reserved_ports /proc/sys/net/ipv4/ip_local_port_range; do
    if [ -r "$path" ]; then
      echo "$path=$(tr -d '\n' < "$path" 2>/dev/null || true)"
    fi
  done
} > "$KERNEL_REPORT" 2>/dev/null || true

{
  echo "# TCP socket diagnostics (best effort)"
  lsof_available=false
  ss_available=false
  lsof_output=''
  if command -v lsof >/dev/null 2>&1; then
    lsof_available=true
    lsof_output=$(run_bounded 10 lsof -nP -iTCP 2>&1 || true)
  elif command -v ss >/dev/null 2>&1; then
    ss_available=true
  fi
  for port in "${valid_ports[@]}"; do
    occupied=false
    echo "port=$port"
    if [ "$lsof_available" = true ]; then
      if lsof_filtered=$(printf '%s\n' "$lsof_output" | awk -v port="$port" '
        /^probe=/ { print; next }
        $1 == "COMMAND" { header = $0; next }
        {
          local_endpoint = $9
          sub(/->.*/, "", local_endpoint)
          if (local_endpoint ~ (":" port "$")) {
            if (!printed_header && header != "") {
              print header
              printed_header = 1
            }
            print
            found = 1
          }
        }
        END { exit found ? 0 : 1 }
      '); then
        occupied=true
      fi
      [ -z "$lsof_filtered" ] || printf '%s\n' "$lsof_filtered"
    elif [ "$ss_available" = true ]; then
      ss -ntp "( sport = :$port )" 2>&1 || true
      if ss -nt "( sport = :$port )" 2>/dev/null | tail -n +2 | grep -q .; then
        occupied=true
      fi
    else
      echo "probe=unavailable (neither lsof nor ss is installed)"
    fi
    echo "status=$([ "$occupied" = true ] && echo occupied || echo free-or-unobserved)"
    echo
  done
} > "$LISTENERS" 2>/dev/null || true

{
  echo "# Docker diagnostics (best effort)"
  if command -v docker >/dev/null 2>&1; then
    run_bounded 10 docker version --format 'server={{.Server.Version}}' 2>&1 || true
    docker_ps_output=$(run_bounded 10 docker ps --no-trunc --format 'container={{.ID}} names={{.Names}} ports={{.Ports}}' 2>&1 || true)
    for port in "${valid_ports[@]}"; do
      echo "published_port=$port"
      printf '%s\n' "$docker_ps_output" | awk -v port="$port" '/^probe=/ || $0 ~ "(^|[^0-9])" port "->"' || true
    done
  else
    echo "docker=unavailable"
  fi
} > "$DOCKER_REPORT" 2>/dev/null || true

{
  echo "# Runner context (deliberately excludes the process environment)"
  uname -a 2>&1 || true
  hostname 2>&1 || true
  id 2>&1 || true
  echo "runner_temp=${RUNNER_TEMP:-unavailable}"
  echo "github_actions=${GITHUB_ACTIONS:-unavailable}"
} > "$RUNNER_REPORT" 2>/dev/null || true

echo "::notice::Port diagnostics captured under $OUTPUT_DIR"
exit 0
