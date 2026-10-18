import { existsSync, realpathSync } from 'node:fs'

import { assessLocal, assessPullRequest, readRepository } from './assess.mts'
import { parseWorktreeList } from './list.mts'
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

/** Lists finished worktrees and, with `yes`, removes them with a plain (never forced) `git worktree remove`. */
export function reclaimWorktrees(yes: boolean, runtime: RunOptions): ReclaimReport {
  const listing = git(['worktree', 'list', '--porcelain', '-z'], runtime)
  const self = git(['rev-parse', '--show-toplevel'], runtime)?.trim()
  const [main, ...others] = parseWorktreeList(listing ?? '')
  if (main === undefined || !self) throw new Error('not inside a git worktree')
  const mainRun: RunOptions = { cwd: main.path, env: runtime.env }
  const selfReal = realpathSync(self)
  const repository = readRepository(mainRun)
  const worktrees: ReclaimEntry[] = []
  for (const { path, branch, locked, bare, detached } of others) {
    if (locked || bare || detached || branch === undefined) continue
    if (!existsSync(path) || realpathSync(path) === selfReal) continue
    const keep = (reason: string): number =>
      worktrees.push({ path, branch, status: 'kept', reason })
    const worktree: RunOptions = { cwd: path, env: runtime.env }
    const local = assessLocal(worktree)
    if ('reason' in local) {
      keep(local.reason)
      continue
    }
    const reason = assessPullRequest(branch, local.head, repository, mainRun)
    if (reason !== undefined) {
      keep(reason)
      continue
    }
    if (!yes) {
      worktrees.push({ path, branch, status: 'would reclaim' })
      continue
    }
    const again = assessLocal(worktree)
    if ('reason' in again || again.head !== local.head) keep('changed before removal')
    else if (git(['worktree', 'remove', path], mainRun) === undefined) {
      keep('git worktree remove refused')
    } else worktrees.push({ path, branch, status: 'reclaimed' })
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
