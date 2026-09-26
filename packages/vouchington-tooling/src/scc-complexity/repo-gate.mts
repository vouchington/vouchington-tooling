import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildSharedContext } from '../shared-context/index.mts'
import {
  checkSccComplexity,
  parseSccComplexityBaseline,
  type SccComplexityScope,
} from './index.mts'

export const REPO_SCC_SCOPE = {
  includePaths: ['.'],
  name: 'source',
} as const satisfies SccComplexityScope

export function repoRootFromModule(moduleUrl: URL = new URL('.', import.meta.url)): string {
  return resolve(fileURLToPath(moduleUrl), '../../../..')
}

interface RepoSccOptions {
  command?: string
  runScc?: (outputPath: string, scope?: SccComplexityScope) => Promise<string>
  stderr?: { write: (chunk: string) => boolean }
}

export async function runRepoSccComplexity(
  root = repoRootFromModule(),
  options: RepoSccOptions = {},
): Promise<number> {
  const baseline = parseSccComplexityBaseline(
    readFileSync(resolve(root, 'scc-complexity-baseline.json'), 'utf8'),
  )
  const result = await checkSccComplexity(
    await buildSharedContext(root),
    {
      baseline,
      scopes: [{ includePaths: [...REPO_SCC_SCOPE.includePaths], name: REPO_SCC_SCOPE.name }],
      ...commandOption(options.command),
    },
    options.runScc,
  )
  if (result.errors.length === 0) return 0
  const stderr = options.stderr ?? {
    write: (chunk: string) => process.stderr.write(chunk),
  }
  stderr.write(`${result.errors.join('\n')}\n`)
  return 1
}

function commandOption(command: string | undefined): { command: string } | Record<string, never> {
  return command === undefined ? {} : { command }
}
