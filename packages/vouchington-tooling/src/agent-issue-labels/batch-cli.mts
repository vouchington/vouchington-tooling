import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { runGh } from '../gh-cli/index.mts'
import { DEFAULT_LABELER_PATH } from './labels-from-paths.mts'
import { parseManifest } from './batch/manifest.mts'
import { executePreflight } from './batch/preflight.mts'
import type { BatchPolicy } from './batch/policy.mts'
import { summarizePreflight } from './batch/summary.mts'

const USAGE = 'Usage: batch-issues preflight --session-dir <path> --repo <owner/repo>'

export type BatchArgs = {
  subcommand: 'preflight'
  sessionDir: string
  repo: string
}

export function parseBatchArgs(argv: string[]): BatchArgs {
  const [subcommand, ...rest] = argv
  if (subcommand !== 'preflight') throw new Error(USAGE)

  let sessionDir: string | undefined
  let repo: string | undefined

  for (let index = 0; index < rest.length; index += 1) {
    const option = rest[index]
    if (option === '--session-dir') {
      if (sessionDir !== undefined) throw new Error('--session-dir may be provided only once')
      sessionDir = rest[(index += 1)]
      if (sessionDir === undefined) throw new Error('--session-dir requires a path')
    } else if (option === '--repo') {
      if (repo !== undefined) throw new Error('--repo may be provided only once')
      repo = rest[(index += 1)]
      if (repo === undefined) throw new Error('--repo requires an owner/repo value')
    } else {
      throw new Error(`Unknown or incomplete option: ${option}`)
    }
  }

  if (sessionDir === undefined) throw new Error('--session-dir is required')
  if (repo === undefined) throw new Error('--repo is required')

  return { subcommand, sessionDir, repo }
}

export type BatchDeps = {
  /** `owner/name` repositories a manifest may target. */
  allowedRepos: readonly string[]
  readManifest: (sessionDir: string) => Promise<string>
  readBody: (path: string) => Promise<string>
  runGh: (args: string[]) => Promise<string>
  pathExists: (path: string) => Promise<boolean>
  writeArtifact: (path: string, data: unknown) => Promise<void>
  labelerPath: string
  policy?: BatchPolicy | undefined
}

async function loadManifest(sessionDir: string, deps: BatchDeps, expectedRepo: string) {
  const manifest = parseManifest(await deps.readManifest(sessionDir), {
    allowedRepos: deps.allowedRepos,
    policy: deps.policy,
  })
  if (manifest.targetRepo !== expectedRepo) {
    throw new Error(
      `CLI --repo "${expectedRepo}" does not match manifest targetRepo "${manifest.targetRepo}"`,
    )
  }
  return manifest
}

/** Read-only GitHub preflight that writes only its JSON report under `sessionDir`. */
export async function executeBatch(
  commandArgs: string[],
  deps: BatchDeps,
): Promise<{ exitCode: number; summary: string }> {
  const args = parseBatchArgs(commandArgs)
  const preflightPath = join(args.sessionDir, 'preflight-report.json')
  const manifest = await loadManifest(args.sessionDir, deps, args.repo)
  const report = await executePreflight(manifest, {
    runGh: deps.runGh,
    pathExists: deps.pathExists,
    readBody: deps.readBody,
    labelerPath: deps.labelerPath,
    sessionDir: args.sessionDir,
    policy: deps.policy,
  })
  await deps.writeArtifact(preflightPath, report)
  return {
    exitCode: report.status === 'pass' ? 0 : 1,
    summary: summarizePreflight(report),
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export type RunBatchCliOptions = {
  /** `owner/name` repositories a manifest may target. */
  allowedRepos: readonly string[]
  /** `actions/labeler` config used to derive path labels; defaults to `.github/labeler.yml`. */
  labelerPath?: string
  /** Priority and dependency label names; defaults to `DEFAULT_BATCH_POLICY`. */
  policy?: BatchPolicy | undefined
  argv?: string[]
  /** Overrides for the filesystem and `gh` seams (defaults use the real ones). */
  deps?: Partial<BatchDeps>
}

/** Runs the batch preflight CLI against the real filesystem and `gh`; sets `process.exitCode`. */
export async function runBatchCli(options: RunBatchCliOptions): Promise<void> {
  const { allowedRepos, labelerPath = DEFAULT_LABELER_PATH, argv = process.argv.slice(2) } = options
  const result = await executeBatch(argv, {
    allowedRepos,
    labelerPath,
    policy: options.policy,
    readManifest: (sessionDir) => readFile(join(sessionDir, 'manifest.json'), 'utf8'),
    readBody: (path) => readFile(path, 'utf8'),
    runGh,
    pathExists,
    writeArtifact: async (path, data) => {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, JSON.stringify(data, null, 2))
    },
    ...options.deps,
  })
  process.stdout.write(result.summary)
  process.exitCode = result.exitCode
}
