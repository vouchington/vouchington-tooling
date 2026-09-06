import type { HarnessPolicyDump } from './types.mts'

export const DEFAULT_EXTRA_WRITABLE_ROOTS = [
  '~/.cargo',
  '~/Library/pnpm',
  '~/.local/share/pnpm',
  '~/.pnpm-store',
  '~/Library/Caches/no-mistakes',
  '~/Library/Caches/pnpm',
  '~/.pnpm-state',
  '~/.cache/no-mistakes',
  '~/.cache/pnpm',
  '~/.local/state/pnpm',
  '/var/folders',
  '/private/var/folders',
] as const

export const CLAUDE_DEFAULT_MODE = 'auto'
export const CODEX_APPROVAL_POLICY = 'on-request'
export const CODEX_APPROVALS_REVIEWER = 'auto_review'
export const CODEX_SANDBOX_MODE = 'workspace-write'
export const GROK_PERMISSION_MODE = 'auto'
export const GROK_SANDBOX_PROFILE = 'workspace-write'
export const GROK_AUTO_MODE_ENABLED = true
export const GROK_DEFAULT_AUTO_MODE = true
export const CURSOR_APPROVAL_MODE = 'auto-review'
export const CURSOR_SANDBOX_MODE = 'enabled'

export function dumpHarnessPolicy(
  extraWritableRoots: readonly string[] = DEFAULT_EXTRA_WRITABLE_ROOTS,
): HarnessPolicyDump {
  return {
    claude: {
      defaultMode: CLAUDE_DEFAULT_MODE,
      sandboxEnabled: true,
      sandboxFailIfUnavailable: true,
      useAutoModeDuringPlan: true,
    },
    codex: {
      approval_policy: CODEX_APPROVAL_POLICY,
      approvals_reviewer: CODEX_APPROVALS_REVIEWER,
      sandbox_mode: CODEX_SANDBOX_MODE,
    },
    cursor: { approvalMode: CURSOR_APPROVAL_MODE, sandboxMode: CURSOR_SANDBOX_MODE },
    extraWritableRoots: [...extraWritableRoots],
    grok: {
      auto_mode_enabled: GROK_AUTO_MODE_ENABLED,
      default_auto_mode: GROK_DEFAULT_AUTO_MODE,
      permission_mode: GROK_PERMISSION_MODE,
      sandbox_profile_defined: GROK_SANDBOX_PROFILE,
      sandbox_profile_requires_cli_selection: true,
    },
  }
}

export function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
