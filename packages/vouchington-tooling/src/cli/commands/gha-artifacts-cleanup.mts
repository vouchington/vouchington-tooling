import { readFileSync } from 'node:fs'
import {
  createArtifactClassifier,
  parseArtifactPatternsJson,
  runCleanup,
  sweepCleanup,
  type DeletionSummary,
} from '../../gha-artifacts-cleanup/index.mts'
import type { ParsedGhaArtifactsCleanup } from '../parse-gha-artifacts-cleanup.mts'

function usage(): string {
  return [
    'Usage: vouchington gha-artifacts-cleanup run --run-id <id> [pattern options]',
    '       vouchington gha-artifacts-cleanup sweep --older-than-hours <n> [pattern options]',
    '',
    'Pattern options: --keep-pattern <glob> --delete-pattern <glob> --patterns-file <json>',
    'Requires GITHUB_TOKEN or GH_TOKEN and GITHUB_REPOSITORY (owner/repo) in the env.',
  ].join('\n')
}

function logSummary(subcommand: string, summary: DeletionSummary): void {
  const mb = (summary.bytesFreed / (1024 * 1024)).toFixed(1)
  console.log(
    `[gha-artifacts-cleanup] ${subcommand}: deleted ${summary.deletedCount} artifact(s), freed ~${mb} MB`,
  )
}

export function loadCleanupPatterns(parsed: ParsedGhaArtifactsCleanup): {
  keepPatterns: string[]
  deletePatterns: string[]
} {
  const fromFile =
    parsed.patternsFile === undefined
      ? { keepPatterns: [], deletePatterns: [] }
      : parseArtifactPatternsJson(JSON.parse(readFileSync(parsed.patternsFile, 'utf8')))
  return {
    keepPatterns: [...fromFile.keepPatterns, ...parsed.keepPatterns],
    deletePatterns: [...fromFile.deletePatterns, ...parsed.deletePatterns],
  }
}

export async function runGhaArtifactsCleanup(
  parsed: ParsedGhaArtifactsCleanup,
  env: Record<string, string | undefined> = process.env,
): Promise<number> {
  const token = env.GITHUB_TOKEN ?? env.GH_TOKEN
  const repo = env.GITHUB_REPOSITORY
  if (!token || !repo) {
    console.error('[gha-artifacts-cleanup] missing GITHUB_TOKEN/GH_TOKEN or GITHUB_REPOSITORY')
    return 0
  }

  const patterns = loadCleanupPatterns(parsed)
  const { classify } = createArtifactClassifier(patterns)
  if (parsed.subcommand === 'run') {
    const runId = parsed.runId
    if (runId === undefined) {
      console.error(usage())
      return 2
    }
    logSummary('run', await runCleanup({ repo, token, classify, runId }))
    return 0
  }
  const olderThanHours = parsed.olderThanHours
  if (olderThanHours === undefined) {
    console.error(usage())
    return 2
  }
  logSummary('sweep', await sweepCleanup({ repo, token, classify, olderThanHours }))
  return 0
}
