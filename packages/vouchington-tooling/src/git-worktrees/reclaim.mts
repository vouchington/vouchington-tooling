import { existsSync, realpathSync } from 'node:fs'

import { assessLocal, assessPullRequest, readRepository } from './assess.mts'
import { parseWorktreeList, type WorktreeRecord } from './list.mts'
import { git, type RunOptions } from './run.mts'

interface ReclaimEntry {
  readonly path: string
  readonly branch: string
  readonly status: 'reclaimed' | 'would reclaim' | 'kept'
  readonly reason?: string
}

export interface ReclaimReport {
  readonly dryRun: boolean
  readonly worktrees: ReclaimEntry[]
}

interface Context {
  readonly yes: boolean
  readonly runtime: RunOptions
  readonly mainRun: RunOptions
  readonly selfReal: string
  readonly repository: string | undefined
}

/** Assesses (and with `yes` removes) one worktree; undefined means it is not a candidate. */
function reclaimOne(record: WorktreeRecord, context: Context): ReclaimEntry | undefined {
  const { path, branch, locked, bare, detached } = record
  if (locked || bare || detached || branch === undefined) return undefined
  if (!existsSync(path) || realpathSync(path) === context.selfReal) return undefined
  const keep = (reason: string): ReclaimEntry => ({ path, branch, status: 'kept', reason })
  const worktree: RunOptions = { cwd: path, env: context.runtime.env }
  const local = assessLocal(worktree)
  if ('reason' in local) return keep(local.reason)
  const reason = assessPullRequest(branch, local.head, context.repository, context.mainRun)
  if (reason !== undefined) return keep(reason)
  if (!context.yes) return { path, branch, status: 'would reclaim' }
  const again = assessLocal(worktree)
  const listed = parseWorktreeList(git(['worktree', 'list', '--porcelain', '-z'], context.runtime))
  const same = listed.some((entry) => entry.path === path && entry.branch === branch)
  if ('reason' in again || again.head !== local.head || !same) return keep('changed since check')
  if (git(['worktree', 'remove', path], context.mainRun) === undefined) {
    return keep('git worktree remove refused')
  }
  return { path, branch, status: 'reclaimed' }
}

/** Lists finished worktrees and, with `yes`, removes them with a plain (never forced) `git worktree remove`. */
export function reclaimWorktrees(yes: boolean, runtime: RunOptions): ReclaimReport {
  const listing = git(['worktree', 'list', '--porcelain', '-z'], runtime)
  const self = git(['rev-parse', '--show-toplevel'], runtime)?.replace(/\n$/, '')
  const [main, ...others] = parseWorktreeList(listing)
  if (main === undefined || !self) throw new Error('not inside a git worktree')
  const mainRun: RunOptions = { cwd: main.path, env: runtime.env }
  const context: Context = {
    yes,
    runtime,
    mainRun,
    selfReal: realpathSync(self),
    repository: readRepository(mainRun),
  }
  const worktrees: ReclaimEntry[] = []
  for (const record of others) {
    try {
      const entry = reclaimOne(record, context)
      if (entry !== undefined) worktrees.push(entry)
    } catch (error) {
      const reason = `error: ${(error as Error).message}`
      worktrees.push({ path: record.path, branch: record.branch as string, status: 'kept', reason })
    }
  }
  return { dryRun: !yes, worktrees }
}

function escape(text: string): string {
  return text.replace(
    /\p{Cc}/gu,
    (char) => `\\x${char.charCodeAt(0).toString(16).padStart(2, '0')}`,
  )
}

export function formatReport(report: ReclaimReport): string {
  return report.worktrees
    .map((entry) => {
      const status = entry.status === 'kept' ? `kept: ${entry.reason}` : entry.status
      return `${escape(entry.path)}: ${escape(status)}\n`
    })
    .join('')
}
