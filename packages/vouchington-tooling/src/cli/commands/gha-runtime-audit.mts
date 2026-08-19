import { execFileSync } from 'node:child_process'

import { auditCiJobRuntime, type GhApiExecutor } from '../../gha-runtime-audit/index.mts'
import type { ParsedGhaRuntimeAudit } from '../parse-gha-runtime-audit.mts'

/* v8 ignore next 10 -- live `gh api` adapter */
function defaultGhApiExecutor(): GhApiExecutor {
  return async (request) =>
    JSON.parse(
      execFileSync('gh', ['api', request.endpoint, '--jq', request.jq], {
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
      }),
    ) as unknown
}

export async function runGhaRuntimeAudit(
  parsed: ParsedGhaRuntimeAudit,
  execute: GhApiExecutor = defaultGhApiExecutor(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const repository = parsed.repository ?? env['GITHUB_REPOSITORY']
  if (!repository) {
    process.stderr.write('vouchington: --repository or GITHUB_REPOSITORY is required\n')
    return 2
  }
  const result = await auditCiJobRuntime(execute, {
    repository,
    workflows: parsed.workflows,
    ...(parsed.branch === undefined ? {} : { branch: parsed.branch }),
  })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  return 0
}
