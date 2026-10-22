import { execFileSync } from 'node:child_process'

import type { GitProbe } from './types.mts'

const WORKTREE_OVERRIDE_ENV = new Set(['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX'])

function probeEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !WORKTREE_OVERRIDE_ENV.has(key)),
  )
}

type Outcome = { ok: true; stdout: string } | { ok: false; status: number | null | undefined }

function run(cwd: string, args: string[]): Outcome {
  try {
    const stdout = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      env: probeEnv(),
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5_000,
    })
    return { ok: true, stdout }
  } catch (err) {
    return { ok: false, status: (err as { status?: number | null }).status }
  }
}

function trimmed(cwd: string, args: string[]): string | undefined {
  const result = run(cwd, args)
  const text = result.ok ? result.stdout.trim() : ''
  return text === '' ? undefined : text
}

const gitCurrentBranch = (cwd: string) => trimmed(cwd, ['branch', '--show-current'])

const gitConfigValue = (cwd: string, key: string) => trimmed(cwd, ['config', '--get', key])

// Full object id a fully qualified ref names, or undefined when the ref is missing or git fails.
const gitResolveRef = (cwd: string, ref: string) =>
  trimmed(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])

// `merge-base --is-ancestor` is exit-code-only: 0 = ancestor, 1 = provably not, anything else
// (128 for an unknown ref, a timeout, a missing binary) is indeterminate and fails open.
function gitIsAncestor(cwd: string, ancestor: string, descendant: string): boolean | undefined {
  const result = run(cwd, ['merge-base', '--is-ancestor', ancestor, descendant])
  if (result.ok) return true
  return result.status === 1 ? false : undefined
}

export function gitRemoteVerbose(cwd: string): string | undefined {
  const result = run(cwd, ['remote', '-v'])
  return result.ok ? result.stdout : undefined
}

// `config --get-regexp` exits 1 when nothing matches, which is an empty answer, not a failure.
export function gitConfiguredRemoteDefaults(cwd: string): string | undefined {
  const result = run(cwd, ['config', '--get-regexp', '^remote\\..+\\.gh-resolved$'])
  if (result.ok) return result.stdout
  return result.status === 1 ? '' : undefined
}

export const defaultGitProbe: GitProbe = {
  currentBranch: gitCurrentBranch,
  configValue: gitConfigValue,
  isAncestor: gitIsAncestor,
  resolveRef: gitResolveRef,
}
