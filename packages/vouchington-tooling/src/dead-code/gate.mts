import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { reconcileBaseline } from './baseline.mts'
import { resolveEntryRoots } from './entry-roots.mts'
import { scanDeadCode } from './scan.mts'
import { copyTrackedWorkingTree } from './tracked-snapshot.mts'

export type DeadCodeOperation = 'check' | 'seed' | 'update'

export type DeadCodeGateOptions = {
  /** Git repository whose tracked working tree is scanned. */
  repoRoot: string
  /** Baseline JSON file, absolute or relative to `repoRoot`. */
  baselinePath: string
  operation?: DeadCodeOperation
  /** jscpd config, relative to `repoRoot` and tracked. Defaults to `.jscpd.json`. */
  configPath?: string | undefined
  /** jscpd executable. Defaults to `<repoRoot>/node_modules/.bin/jscpd`. */
  binary?: string | undefined
  /** Live entry roots (files or globs). Defaults to the config's `deadCode.entry`. */
  entryRoots?: readonly string[] | undefined
  /** Tracked-file globs left out of the snapshot. */
  snapshotIgnore?: readonly string[] | undefined
  /** Finding path globs that are not counted. */
  excludeFindings?: readonly string[] | undefined
  /** Optional deadline source forwarded to child processes. */
  remaining?: (() => number) | undefined
}

export type DeadCodeGateResult = {
  operation: DeadCodeOperation
  identities: number
  trackedFiles: number
  /** Stale identities removed by `update`; 0 for `seed` and `check`. */
  removed: number
}

/** Scans a tracked snapshot and checks, seeds, or shrinks the committed baseline. */
export async function runDeadCodeGate(options: DeadCodeGateOptions): Promise<DeadCodeGateResult> {
  const operation = options.operation ?? 'check'
  const repoRoot = resolve(options.repoRoot)
  const baselinePath = resolve(repoRoot, options.baselinePath)
  const configPath = options.configPath ?? '.jscpd.json'
  if (operation === 'seed' && existsSync(baselinePath)) {
    throw new Error('Initial baseline already exists; --seed cannot replace it')
  }
  if (operation !== 'seed' && !existsSync(baselinePath)) {
    throw new Error('Dead-code baseline is missing; --seed is required for first adoption')
  }
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'dead-code-gate-'))
  try {
    const snapshotRoot = join(temporaryRoot, 'snapshot')
    const trackedFiles = await copyTrackedWorkingTree(
      repoRoot,
      snapshotRoot,
      options.remaining,
      options.snapshotIgnore,
    )
    await resolveEntryRoots(snapshotRoot, configPath, options.entryRoots)
    const current = await scanDeadCode(
      snapshotRoot,
      join(temporaryRoot, 'report'),
      options.binary ?? join(repoRoot, 'node_modules/.bin/jscpd'),
      options.remaining,
      { configPath, excludeGlobs: options.excludeFindings },
    )
    const removed = await reconcileBaseline(baselinePath, current, operation)
    return { operation, identities: current.length, trackedFiles, removed }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}
