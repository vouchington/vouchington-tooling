#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { writeVitestBlobManifest } from './index.mts'
import { parseGitHubRunAttempt } from './run-attempt.mts'

function failRepository(): never {
  throw new Error('GITHUB_REPOSITORY is required')
}

export function runVitestBlobManifestCli(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  revision = execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim(),
): void {
  const [suite, directory = '.vitest-reports', ...extra] = args
  const runId = env.GITHUB_RUN_ID
  const rawAttempt = env.GITHUB_RUN_ATTEMPT
  if (!suite || extra.length > 0 || !runId || !rawAttempt) {
    throw new Error('Usage: vouchington vitest-blob-manifest <suite> [reports-directory]')
  }
  const runAttempt = parseGitHubRunAttempt(rawAttempt)
  writeVitestBlobManifest(directory, {
    suite,
    repository: env.GITHUB_REPOSITORY || failRepository(),
    revision,
    runId,
    runAttempt,
  })
}

/* v8 ignore next 3 -- exercised as an executable by the composite action contract */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runVitestBlobManifestCli(process.argv.slice(2))
}
