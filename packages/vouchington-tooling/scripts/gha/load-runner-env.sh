#!/usr/bin/env bash
set -euo pipefail

if [ -z "${GITHUB_ENV:-}" ]; then
  echo 'GITHUB_ENV must be set' >&2
  exit 2
fi

WORKER_VAR_NAMES="${WORKER_VAR_NAMES:-}"
env_file="${RUNNER_ENV_FILE:-${HOME}/.github-actions.env}"

_write_workers_var() {
  local name="$1"
  local value="${2:-}"
  if [ -n "$value" ]; then
    value=$(printf '%s' "$value" | tr -d '\n\r')
    value=$(printf '%s' "$value" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')
    if printf '%s' "$value" | grep -qE '^[1-9][0-9]*%?$'; then
      printf '%s=%s\n' "$name" "$value" >> "$GITHUB_ENV"
    else
      echo "::warning::$name='$value' is not a valid worker count (positive integer or percentage) — ignoring"
    fi
  fi
}

_is_worker_var() {
  local candidate="$1"
  local name
  [ -z "$WORKER_VAR_NAMES" ] && return 1
  for name in $WORKER_VAR_NAMES; do
    if [ "$name" = "$candidate" ]; then
      return 0
    fi
  done
  return 1
}

if [ -n "$WORKER_VAR_NAMES" ]; then
  for name in $WORKER_VAR_NAMES; do
    input_name="INPUT_${name}"
    _write_workers_var "$name" "${!input_name:-}"
  done
fi

if [ ! -f "$env_file" ]; then
  exit 0
fi

echo "::debug::Loading runner environment from ${env_file}"
while IFS='=' read -r key value; do
  case "$key" in
    NODE_OPTIONS)
      echo "::warning::Refusing to load NODE_OPTIONS from ${env_file} — GitHub Actions blocks NODE_OPTIONS writes through GITHUB_ENV; set it in workflow env instead"
      ;;
    AWS_*)
      echo "::warning::Refusing to load $key from ${env_file} — AWS credentials must come from aws-actions/configure-aws-credentials (OIDC)"
      ;;
    BASH_ENV | ENV | PATH | LD_* | DYLD_* | GIT_*)
      echo "::warning::Refusing to load $key from ${env_file} — $key can hijack shell startup, the dynamic loader, PATH, or git in privileged steps; set it explicitly in workflow env if genuinely required"
      ;;
    *)
      if _is_worker_var "$key"; then
        _write_workers_var "$key" "$value"
      else
        printf '%s=%s\n' "$key" "$value" >> "$GITHUB_ENV"
      fi
      ;;
  esac
done < <(
  grep -vE '^[[:space:]]*(#|$)' "$env_file" \
    | sed -E 's/^[[:space:]]*export[[:space:]]+//' \
    | tr -d '\r' \
    | grep -E '^[A-Za-z_][A-Za-z0-9_]*=' \
    || true
)
