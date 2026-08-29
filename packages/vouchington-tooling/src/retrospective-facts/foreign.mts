import { rawBlock } from './exec.mts'
import { apiFiles, count, dirs, format, objectField, readJson, stringField } from './format.mts'
import { PR_JSON_FIELDS, type CommandExecutor, type RetrospectiveFactsOptions } from './shared.mts'

export async function foreignFacts(
  options: RetrospectiveFactsOptions,
  execute: CommandExecutor,
): Promise<string> {
  const args = ['pr', 'view', options.pr!, '--repo', options.repo!, '--json', PR_JSON_FIELDS]
  const result = await execute('gh', args)
  const data = result.ok ? readJson(result.stdout) : undefined
  const state = stringField(data, 'state', result.ok ? 'unavailable' : 'gh failed')
  const merged =
    state === 'MERGED'
      ? 'yes (GitHub reports PR MERGED)'
      : state === 'OPEN' || state === 'CLOSED'
        ? `no (GitHub reports PR ${state})`
        : 'unavailable'
  return format(
    {
      fetch: 'not run (scoped GitHub repository)',
      fetchStatus: 'not run',
      fetchNote: 'scoped GitHub state is authoritative',
      branch: stringField(data, 'headRefName'),
      pr: stringField(data, 'number'),
      state,
      mergedAt: stringField(data, 'mergedAt'),
      mergeCommit: objectField(data, 'mergeCommit', 'oid'),
      merged,
      commits: 'unavailable',
      prCommits: count(data, 'commits'),
      files: apiFiles(data),
      dirs: dirs(data),
      changeSource: 'api',
      scoped: `${options.repo}#${options.pr}`,
    },
    options.raw ? rawBlock('gh', args, result) : '',
  )
}
