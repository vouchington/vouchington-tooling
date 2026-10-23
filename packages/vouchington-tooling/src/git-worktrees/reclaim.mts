import { existsSync, realpathSync } from 'node:fs'
import { sep } from 'node:path'

import {
  assessLocal,
  assessPullRequest,
  assessListedPulls,
  readPullSnapshot,
  readRepository,
  type PullRequest,
} from './assess.mts'
import { parseWorktreeList, type WorktreeRecord } from './list.mts'
import { git, type RunOptions } from './run.mts'

interface ReclaimEntry {
  readonly path: string
  readonly branch: string
  readonly status: 'reclaimed' | 'would reclaim' | 'kept'
  readonly reason?: string
}

export type ReclaimReport = {
  readonly dryRun: boolean
  readonly worktrees: ReclaimEntry[]
} & (
  | { readonly hasMore: true; readonly nextAfter: string }
  | { readonly hasMore: false; readonly nextAfter?: never }
)

export interface ReclaimOptions {
  readonly prLimit?: number
  readonly maxWorktrees?: number
  readonly timeoutMs?: number
  readonly after?: string
  readonly now?: () => number
}

interface Context {
  readonly yes: boolean
  readonly now: () => number
  readonly deadline: number
  readonly runtime: RunOptions
  readonly mainRun: RunOptions
  readonly selfReal: string
  readonly registered: readonly string[]
  readonly repository: string | undefined
  readonly pulls: readonly PullRequest[] | undefined
}

/** Assesses (and with `yes` removes) one worktree; undefined means it is not a candidate. */
function reclaimOne(record: WorktreeRecord, context: Context): ReclaimEntry | undefined {
  const { path, branch, locked, bare, detached } = record
  if (locked || bare || detached || branch === undefined) return undefined
  if (!existsSync(path) || realpathSync(path) === context.selfReal) return undefined
  const keep = (reason: string): ReclaimEntry => ({ path, branch, status: 'kept', reason })
  const nests = (paths: readonly string[]): boolean =>
    paths.some((other) => other.startsWith(path + sep))
  if (nests(context.registered)) {
    return keep('contains another worktree')
  }
  const worktree: RunOptions = { ...context.runtime, cwd: path }
  const local = assessLocal(worktree)
  if ('reason' in local) return keep(local.reason)
  const reason = assessListedPulls(context.pulls, branch, local.head, context.repository)
  if (reason !== undefined) return keep(reason)
  if (!context.yes) return { path, branch, status: 'would reclaim' }
  const pullAgain = assessPullRequest(branch, local.head, context.repository, context.mainRun)
  const again = assessLocal(worktree)
  const listed = parseWorktreeList(git(['worktree', 'list', '--porcelain', '-z'], context.runtime))
  const same = listed.some(
    (entry) => entry.path === path && entry.branch === branch && entry.head === local.head,
  )
  if (nests(listed.map((entry) => entry.path))) return keep('contains another worktree')
  if ('reason' in again || again.head !== local.head || pullAgain !== undefined || !same)
    return keep('changed since check')
  if (context.now() >= context.deadline) return keep('scan budget exhausted')
  if (git(['worktree', 'remove', path], { ...context.mainRun, timeout: 0 }) === undefined) {
    return keep('git worktree remove refused')
  }
  return { path, branch, status: 'reclaimed' }
}

/** Lists finished worktrees and, with `yes`, removes them with a plain (never forced) `git worktree remove`. */
export function reclaimWorktrees(
  yes: boolean,
  runtime: RunOptions,
  options: ReclaimOptions = {},
): ReclaimReport {
  const prLimit = options.prLimit ?? 1000
  const maxWorktrees = options.maxWorktrees ?? 100
  const timeoutMs = options.timeoutMs ?? 30_000
  if (
    !Number.isSafeInteger(prLimit) ||
    prLimit < 1 ||
    prLimit > 10_000 ||
    !Number.isSafeInteger(maxWorktrees) ||
    maxWorktrees < 1 ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1
  )
    throw new Error('scan limits must be positive integers; PR limit must not exceed 10000')
  const now = options.now ?? Date.now
  const deadline = now() + timeoutMs
  runtime = { ...runtime, deadline, now }
  const listing = git(['worktree', 'list', '--porcelain', '-z'], runtime)
  const self = git(['rev-parse', '--show-toplevel'], runtime)?.replace(/\n$/, '')
  const [main, ...others] = parseWorktreeList(listing)
  if (main === undefined || !self) throw new Error('not inside a git worktree')
  const mainRun: RunOptions = { ...runtime, cwd: main.path }
  const repository = readRepository(mainRun)
  const context: Context = {
    yes,
    now,
    deadline,
    runtime,
    mainRun,
    selfReal: realpathSync(self),
    registered: [main, ...others].map((record) => record.path),
    repository,
    pulls: repository === undefined ? undefined : readPullSnapshot(mainRun, prLimit),
  }
  const worktrees: ReclaimEntry[] = []
  const pending = others
    .filter((record) => options.after === undefined || record.path > options.after)
    .sort((a, b) => Number(a.path > b.path) - Number(a.path < b.path))
  let processed = 0
  let nextAfter = options.after ?? ''
  for (const record of pending) {
    if (processed >= maxWorktrees || now() >= deadline) break
    try {
      const entry = reclaimOne(record, context)
      if (entry !== undefined) worktrees.push(entry)
    } catch (error) {
      const reason = `error: ${(error as Error).message}`
      worktrees.push({ path: record.path, branch: record.branch as string, status: 'kept', reason })
    }
    if (now() >= deadline) break
    processed += 1
    nextAfter = record.path
  }
  const hasMore = processed < pending.length
  return hasMore
    ? { dryRun: !yes, worktrees, hasMore: true, nextAfter }
    : { dryRun: !yes, worktrees, hasMore: false }
}

function escape(text: string): string {
  return text.replace(
    /\p{Cc}/gu,
    (char) => `\\x${char.charCodeAt(0).toString(16).padStart(2, '0')}`,
  )
}

export function formatReport(report: ReclaimReport): string {
  return (
    report.worktrees
      .map((entry) => {
        const status = entry.status === 'kept' ? `kept: ${entry.reason}` : entry.status
        return `${escape(entry.path)}: ${escape(status)}\n`
      })
      .join('') +
    (report.hasMore ? `Scan incomplete; resume with --after ${quote(report.nextAfter)}\n` : '')
  )
}

function quote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'"
}
