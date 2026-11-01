import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { diffFileName, renderDiffIndex, splitDiff } from '../diff-files.mts'
import { numberDiff } from '../numbered-diff.mts'
import type { EvalCase } from './cases.mts'

/** Runs a binary and resolves stdout; rejects on a non-zero exit. */
export type Exec = (command: string, args: string[], options?: { cwd?: string }) => Promise<string>

const execFileAsync = promisify(execFile)

const TAIL = 600

function tail(text: string): string {
  return text.trim().slice(-TAIL)
}

/** Runs a binary; a failure reports the exit code and output tails, never the (long) arguments. */
export const defaultExec: Exec = async (command, args, options = {}) => {
  try {
    const { stdout } = await execFileAsync(command, args, {
      ...options,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    })
    return stdout
  } catch (error) {
    // execFile errors carry the captured output as strings (empty when the binary never ran).
    const failure = error as { code?: unknown; stdout: string; stderr: string }
    const parts = [
      `${command} exited with ${String(failure.code)}`,
      tail(failure.stdout),
      tail(failure.stderr),
    ]
    throw new Error(parts.filter((part) => part.length > 0).join('\n'), { cause: error })
  }
}

export type Snapshot = {
  /** Git-free tree of the pull request head; the reviewer's working directory. */
  dir: string
  diff: string
  body: string
}

/** Context files a pillar reads, kept inside the snapshot so read-only tools can reach them. */
export const CONTEXT_DIR = '.final-review'

/**
 * Exports the pre-merge head as a tree without `.git`, so the reviewer cannot read later history
 * (the revert, follow-up fixes) that would leak the answer.
 */
export async function prepareSnapshot(
  item: EvalCase,
  cacheRoot: string,
  workRoot: string,
  exec: Exec = defaultExec,
): Promise<Snapshot> {
  const repoDir = join(cacheRoot, item.repo.replace('/', '__'))
  if (!existsSync(join(repoDir, '.git'))) {
    mkdirSync(cacheRoot, { recursive: true })
    await exec('gh', [
      'repo',
      'clone',
      item.repo,
      repoDir,
      '--',
      '--filter=blob:none',
      '--no-checkout',
      '--quiet',
    ])
  }
  await exec('git', ['-C', repoDir, 'fetch', '--quiet', 'origin', item.baseSha, item.headSha])
  const caseRoot = join(workRoot, item.id)
  const dir = join(caseRoot, 'tree')
  rmSync(caseRoot, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const tar = join(caseRoot, 'tree.tar')
  await exec('git', ['-C', repoDir, 'archive', '--format=tar', '-o', tar, item.headSha])
  await exec('tar', ['-xf', tar, '-C', dir])
  rmSync(tar, { force: true })
  const diff = await exec('git', [
    '-C',
    repoDir,
    'diff',
    '--no-color',
    `${item.baseSha}...${item.headSha}`,
  ])
  const body = await exec('gh', [
    'pr',
    'view',
    String(item.pr),
    '-R',
    item.repo,
    '--json',
    'body',
    '-q',
    '.body',
  ])
  const context = join(dir, CONTEXT_DIR)
  mkdirSync(context, { recursive: true })
  const numbered = numberDiff(diff)
  writeFileSync(join(context, 'diff.patch'), numbered)
  // Per-file patches and an index let a reviewer of a large diff read one file at a time.
  const files = splitDiff(numbered)
  mkdirSync(join(context, 'diff'), { recursive: true })
  files.forEach((file, index) => {
    writeFileSync(join(context, 'diff', diffFileName(index)), file.text)
  })
  writeFileSync(join(context, 'files.md'), renderDiffIndex(files, `${CONTEXT_DIR}/diff`))
  writeFileSync(join(context, 'pr.md'), `# ${item.title}\n\n${body.trim()}\n`)
  return { dir, diff, body }
}
