import { spawnSync } from 'node:child_process'

import { classifyFreshBase } from './classify.mts'
import type { FreshBaseClassification, FreshBaseFetch, FreshBaseTree } from './classify.mts'

export interface GitResult {
  readonly status: number
  readonly stdout: string
}

export type GitRunner = (args: readonly string[], cwd?: string, timeoutMs?: number) => GitResult

export interface FreshBaseOptions {
  readonly remote?: string
  readonly branch?: string
  readonly cwd?: string
  /** Skip the refresh and compare against the cached remote-tracking ref. */
  readonly skipFetch?: boolean
  readonly fetchTimeoutMs?: number
  readonly git?: GitRunner
}

export interface FreshBaseReport extends FreshBaseClassification {
  readonly base: string
  /** Current branch name, or `detached HEAD`. */
  readonly branch: string
}

const DEFAULT_FETCH_TIMEOUT_MS = 8000

const defaultGit: GitRunner = (args, cwd, timeoutMs) => {
  const result = spawnSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }),
  })
  return { status: result.status ?? 1, stdout: result.stdout ?? '' }
}

function validateName(value: string, option: string): void {
  if (value === '' || value.startsWith('-')) {
    throw new Error(`${option} must be a non-option Git name`)
  }
}

function countsOf(git: GitRunner, ref: string, cwd?: string) {
  // A shallow history can hide the ancestry that connects HEAD and the base.
  const shallow = git(['rev-parse', '--is-shallow-repository'], cwd)
  if (shallow.status !== 0 || shallow.stdout.trim() !== 'false') {
    return { ahead: null, behind: null }
  }
  const counts = git(['rev-list', '--left-right', '--count', `${ref}...HEAD`], cwd)
  const [behind, ahead] = counts.stdout.trim().split(/\s+/u).map(Number)
  if (counts.status !== 0 || !Number.isInteger(behind) || !Number.isInteger(ahead)) {
    return { ahead: null, behind: null }
  }
  return { ahead: ahead as number, behind: behind as number }
}

/**
 * Refreshes the base, then classifies the worktree against it. Returns null outside a Git
 * repository. Git failures never throw; they surface as `fetch-failed` or `unknown`.
 */
export function checkFreshBase(options: FreshBaseOptions = {}): FreshBaseReport | null {
  const remote = options.remote ?? 'origin'
  const branch = options.branch ?? 'main'
  validateName(remote, 'remote')
  validateName(branch, 'branch')
  const git = options.git ?? defaultGit
  const { cwd } = options
  if (git(['rev-parse', '--git-dir'], cwd).status !== 0) return null
  if (git(['check-ref-format', '--branch', branch], cwd).status !== 0) {
    throw new Error('branch must be a valid Git branch name')
  }

  const ref = `refs/remotes/${remote}/${branch}`
  let fetch: FreshBaseFetch = 'skipped'
  if (options.skipFetch !== true) {
    const timeout = options.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS
    const fetched = git(['fetch', remote, `+refs/heads/${branch}:${ref}`, '--quiet'], cwd, timeout)
    fetch = fetched.status === 0 ? 'fresh' : 'failed'
  }

  const current = git(['branch', '--show-current'], cwd).stdout.trim()
  const status = git(['status', '--porcelain', '--untracked-files=normal'], cwd)
  let tree: FreshBaseTree = 'unknown'
  if (status.status === 0) tree = status.stdout.trim() === '' ? 'clean' : 'dirty'

  const available = git(['rev-parse', '--verify', '--quiet', ref], cwd).status === 0
  const counts = available ? countsOf(git, ref, cwd) : { ahead: null, behind: null }
  return {
    ...classifyFreshBase({ ...counts, tree, fetch }),
    base: `${remote}/${branch}`,
    branch: current === '' ? 'detached HEAD' : current,
  }
}
