import type { RunTextCommand } from '../gh-cli/exec.mts'
import type { LivePullRequest } from './pr-live.mts'

/** What the policy's `validatePullRequest` learns about the size of the change. */
export type DiffSize =
  | { additions: number; deletions: number; changedFiles: number; source: 'github' | 'git' }
  | { unavailable: string }

/** The longest the local diff may run, and the most numstat output it may produce. */
const DIFF_TIMEOUT_MS = 30_000
export const DIFF_MAX_OUTPUT = 1024 * 1024

/** Sums `git diff --numstat` output; a binary file (`-`) counts as a file with no lines. */
export function parseNumstat(output: string): DiffSize {
  let additions = 0
  let deletions = 0
  let changedFiles = 0
  for (const line of output.split('\n')) {
    if (line === '') continue
    const [added, removed] = line.split('\t')
    changedFiles += 1
    additions += Number(added) || 0
    deletions += Number(removed) || 0
  }
  return { additions, deletions, changedFiles, source: 'git' }
}

/** execFile kills the child on its timeout (`killed`, with a signal) and fails on a full buffer. */
function failureReason(error: unknown, base: string): string {
  const { killed, code } = (error ?? {}) as { killed?: unknown; code?: unknown }
  if (killed === true) return 'git diff timed out'
  if (code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return 'git diff output too large'
  return `git diff origin/${base}...HEAD failed`
}

/** The change a pull request with no live counterpart would carry: `origin/<base>...HEAD`. */
async function localDiff(git: RunTextCommand, base: string): Promise<DiffSize> {
  try {
    const output = await git(
      ['diff', '--numstat', '--no-ext-diff', `origin/${base}...HEAD`, '--'],
      {
        timeout: DIFF_TIMEOUT_MS,
        maxBuffer: DIFF_MAX_OUTPUT,
      },
    )
    if (output.length > DIFF_MAX_OUTPUT) return { unavailable: 'git diff output too large' }
    return parseNumstat(output)
  } catch (error) {
    return { unavailable: failureReason(error, base) }
  }
}

/** GitHub's own counts for a live pull request, else the local numstat. Never throws. */
export async function diffFor(
  git: RunTextCommand,
  live: LivePullRequest | undefined,
  base: string,
): Promise<DiffSize> {
  if (live === undefined) return localDiff(git, base)
  const { additions, deletions, changedFiles } = live
  return { additions, deletions, changedFiles, source: 'github' }
}
