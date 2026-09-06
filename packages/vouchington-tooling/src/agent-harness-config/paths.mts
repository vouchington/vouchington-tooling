import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  CLAUDE_DEFAULT_MODE,
  CODEX_APPROVAL_POLICY,
  CODEX_APPROVALS_REVIEWER,
  CODEX_SANDBOX_MODE,
  CURSOR_APPROVAL_MODE,
  CURSOR_SANDBOX_MODE,
  DEFAULT_EXTRA_WRITABLE_ROOTS,
  GROK_AUTO_MODE_ENABLED,
  GROK_DEFAULT_AUTO_MODE,
  GROK_PERMISSION_MODE,
  GROK_SANDBOX_PROFILE,
} from './policy.mts'
import { HARNESS_IDS, type FilePlan, type HarnessConfigOptions, type HarnessId } from './types.mts'

function selected(options: HarnessConfigOptions | undefined): ReadonlySet<HarnessId> {
  return new Set(options?.harnesses ?? HARNESS_IDS)
}

function extraRoots(options: HarnessConfigOptions | undefined): readonly string[] {
  return options?.extraWritableRoots ?? DEFAULT_EXTRA_WRITABLE_ROOTS
}

function wants(set: ReadonlySet<HarnessId>, id: HarnessId): boolean {
  return set.has(id)
}

function codexPatches(roots: readonly string[]): FilePlan {
  return {
    format: 'toml',
    patches: [
      { key: 'approval_policy', table: '', value: CODEX_APPROVAL_POLICY },
      { key: 'approvals_reviewer', table: '', value: CODEX_APPROVALS_REVIEWER },
      { key: 'sandbox_mode', table: '', value: CODEX_SANDBOX_MODE },
      { key: 'network_access', table: 'sandbox_workspace_write', value: true },
      { key: 'writable_roots', table: 'sandbox_workspace_write', value: roots },
    ],
    path: '',
  }
}

function grokSandboxPatches(roots: readonly string[]): FilePlan {
  return {
    format: 'toml',
    patches: [
      { key: 'extends', table: 'profiles.workspace-write', value: 'workspace' },
      { key: 'read_write', table: 'profiles.workspace-write', value: roots },
    ],
    path: '',
  }
}

function homeDir(options: HarnessConfigOptions | undefined): string {
  return resolve(options?.home ?? homedir())
}

export function planGlobalFiles(options?: HarnessConfigOptions): FilePlan[] {
  const harnesses = selected(options)
  const roots = extraRoots(options)
  const home = homeDir(options)
  const files: FilePlan[] = []
  if (wants(harnesses, 'claude')) {
    files.push({
      format: 'json',
      patches: [
        { path: ['permissions', 'defaultMode'], value: CLAUDE_DEFAULT_MODE },
        { path: ['sandbox', 'enabled'], value: true },
        { merge: 'union', path: ['sandbox', 'filesystem', 'allowWrite'], value: roots },
        { path: ['useAutoModeDuringPlan'], value: true },
      ],
      path: join(home, '.claude', 'settings.json'),
    })
  }
  if (wants(harnesses, 'codex'))
    files.push({ ...codexPatches(roots), path: join(home, '.codex', 'config.toml') })
  if (wants(harnesses, 'grok')) {
    files.push({ ...grokSandboxPatches(roots), path: join(home, '.grok', 'sandbox.toml') })
    files.push({
      format: 'toml',
      patches: [
        { key: 'permission_mode', table: 'ui', value: GROK_PERMISSION_MODE },
        { key: 'enabled', table: 'auto_mode', value: GROK_AUTO_MODE_ENABLED },
        { key: 'default_auto_mode', table: '', value: GROK_DEFAULT_AUTO_MODE },
        { key: 'profile', table: 'sandbox', value: GROK_SANDBOX_PROFILE },
      ],
      path: join(home, '.grok', 'config.toml'),
    })
  }
  if (wants(harnesses, 'cursor')) {
    files.push({
      format: 'json',
      patches: [
        { path: ['approvalMode'], value: CURSOR_APPROVAL_MODE },
        { path: ['sandbox', 'mode'], value: CURSOR_SANDBOX_MODE },
      ],
      path: join(home, '.cursor', 'cli-config.json'),
    })
  }
  return files
}

export function planRepoFiles(root: string, options?: HarnessConfigOptions): FilePlan[] {
  const harnesses = selected(options)
  const roots = extraRoots(options)
  const repo = resolve(root)
  const files: FilePlan[] = []
  if (wants(harnesses, 'claude')) {
    files.push({
      format: 'json',
      patches: [
        { path: ['sandbox', 'enabled'], value: true },
        { merge: 'union', path: ['sandbox', 'filesystem', 'allowWrite'], value: roots },
      ],
      path: join(repo, '.claude', 'settings.json'),
    })
  }
  if (wants(harnesses, 'codex'))
    files.push({ ...codexPatches(roots), path: join(repo, '.codex', 'config.toml') })
  if (wants(harnesses, 'grok'))
    files.push({ ...grokSandboxPatches(roots), path: join(repo, '.grok', 'sandbox.toml') })
  if (wants(harnesses, 'cursor')) {
    files.push({
      format: 'json',
      patches: [{ path: ['approvalMode'], value: CURSOR_APPROVAL_MODE }],
      path: join(repo, '.cursor', 'cli.json'),
    })
    files.push({
      format: 'json',
      patches: [
        { path: ['type'], value: 'workspace_readwrite' },
        { path: ['enableSharedBuildCache'], value: true },
        { path: ['networkPolicy', 'default'], value: 'allow' },
        { path: ['additionalReadwritePaths'], value: roots },
      ],
      path: join(repo, '.cursor', 'sandbox.json'),
    })
  }
  return files
}
