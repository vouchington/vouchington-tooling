import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

import { createGhApi, createGhRunner } from '../../transient-retry/gh-api.mts'
import { rerunKnownTransient } from '../../transient-retry/rerun.mts'
import { commandUsage } from '../usage.mts'
import type { LogLimits } from '../../transient-retry/log-window.mts'
import type { WorkflowRetryRule } from '../../transient-retry/run-context-types.mts'

interface RulesModule {
  rules?: unknown
  limits?: Partial<LogLimits>
}

type LoadModule = (specifier: string) => Promise<RulesModule>

const loadModule: LoadModule = (specifier) => import(specifier) as Promise<RulesModule>

/**
 * `vouchington transient-retry --rules <module> [--repo owner/name] [--token-env NAME] [--dry-run]
 * <run-id>`. The module must export `rules` (an array of retry rules) and may export `limits`.
 * Exits 0 when a rerun was requested, 2 when none is warranted, 1 on error.
 */
export async function runTransientRetryCommand(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  load: LoadModule = loadModule,
): Promise<number> {
  let parsed: ReturnType<typeof parse>
  try {
    parsed = parse(args)
  } catch (error) {
    process.stderr.write(
      `vouchington: ${(error as Error).message}\n${commandUsage('transient-retry')}`,
    )
    return 2
  }
  const { values, positionals } = parsed
  const [runId, extra] = positionals
  if (values.rules === undefined || runId === undefined || extra !== undefined) {
    process.stderr.write(
      `vouchington: expected --rules <module> and one run id\n${commandUsage('transient-retry')}`,
    )
    return 2
  }
  const repository = values.repo ?? env.GITHUB_REPOSITORY
  try {
    const module = await load(pathToFileURL(resolve(values.rules)).href)
    if (!Array.isArray(module.rules)) throw new Error('rules module must export a `rules` array')
    return await rerunKnownTransient({
      api: createGhApi({ run: createGhRunner(values['token-env']) }),
      dryRun: values['dry-run'],
      rules: module.rules as WorkflowRetryRule[],
      runId,
      ...(module.limits === undefined ? {} : { limits: module.limits }),
      ...(repository === undefined ? {} : { repository }),
    })
  } catch (error) {
    process.stderr.write(`vouchington: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}

function parse(args: readonly string[]) {
  return parseArgs({
    args: [...args],
    allowPositionals: true,
    options: {
      'dry-run': { type: 'boolean', default: false },
      repo: { type: 'string' },
      rules: { type: 'string' },
      'token-env': { type: 'string' },
    },
  })
}
