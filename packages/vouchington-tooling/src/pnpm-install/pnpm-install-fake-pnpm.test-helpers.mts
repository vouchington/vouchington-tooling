export function fakePnpmScript() {
  return `#!/usr/bin/env bash
set -euo pipefail
if [ "\${1:-}" = m ]; then
  if [ -n "\${PNPM_LIST_WARNING:-}" ]; then printf '%s\\n' "$PNPM_LIST_WARNING" >&2; fi
  printf '%s\\n' "$PNPM_WORKSPACES_JSON"
  exit 0
fi
if [ "\${1:-}" = --version ]; then
  printf '%s\\n' "\${PNPM_VERSION:-11.0.0}"
  exit 0
fi
printf '%s\\n' "$*" >> "$PNPM_LOG"
calls=0
if [ -f "$PNPM_CALLS" ]; then calls="$(cat "$PNPM_CALLS")"; fi
calls=$((calls + 1))
printf '%s' "$calls" > "$PNPM_CALLS"
print_release_age_violation() {
  printf '%s\\n' '✗ Lockfile failed supply-chain policy check (1 entries in 0.1s)'
  printf '%s\\n' '[ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION] 1 lockfile entries failed verification:'
  printf '%s\\n' '  undici@8.10.0 was published at 2026-08-03T15:06:33.000Z, within the minimumReleaseAge cutoff (2026-08-02T04:48:10.357Z)'
}
if [ "\${PNPM_FAIL_CALL:-0}" = "$calls" ]; then
  if [ -n "\${PNPM_FAIL_RELEASE_AGE:-}" ]; then print_release_age_violation; fi
  exit "\${PNPM_FAIL_CODE:-1}"
fi
if [ "\${PNPM_FAIL_RELEASE_AGE_CALL:-0}" = "$calls" ]; then
  print_release_age_violation
  exit 1
fi
if [ -n "\${PNPM_SLEEP_SECONDS:-}" ]; then sleep "$PNPM_SLEEP_SECONDS"; fi
if [ -n "\${PNPM_PENDING_BUILDS:-}" ]; then
  mkdir -p "$PNPM_NODE_MODULES"
  printf 'pendingBuilds: [%s]\\n' "$PNPM_PENDING_BUILDS" > "$PNPM_NODE_MODULES/.modules.yaml"
fi
case " $* " in
  *' rebuild '*)
    if [ "\${PNPM_REBUILD_INVALID_LEDGER:-0}" = 1 ]; then
      printf 'pendingBuilds: invalid\n' > "$PNPM_NODE_MODULES/.modules.yaml"
    fi
    if [ "\${PNPM_REBUILD_BREAK_LINK:-0}" = 1 ]; then rm -f "$PNPM_DEPENDENCY_LINK"; fi
    ;;
  *' --force '*)
    if [ "\${PNPM_DELETE_NATIVE:-0}" = 1 ]; then
      rm -f "$PNPM_NATIVE_ADDON"
    elif [ "\${PNPM_REPAIR_NATIVE:-0}" = 1 ]; then
      cp "$PNPM_NATIVE_REPLACEMENT" "$PNPM_NATIVE_ADDON"
    fi
    if [ "\${PNPM_FORCE_BREAK_LINK:-0}" = 1 ]; then rm -f "$PNPM_DEPENDENCY_LINK"; fi
    if [ "\${PNPM_REPAIR_LINK:-0}" = 1 ]; then
      mkdir -p "$(dirname "$PNPM_DEPENDENCY_LINK")"
      rm -f "$PNPM_DEPENDENCY_LINK"
      ln -s "$PNPM_DEPENDENCY" "$PNPM_DEPENDENCY_LINK"
    fi
    ;;
esac
`
}
