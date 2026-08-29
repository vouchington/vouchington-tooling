import { rawBlock } from './exec.mts'
import {
  apiFiles,
  count,
  dirs,
  format,
  objectField,
  readJson,
  stringField,
  topDirs,
} from './format.mts'
import {
  PR_JSON_FIELDS,
  type CommandExecutor,
  type CommandResult,
  type RetrospectiveFactsOptions,
} from './shared.mts'

type Captured = { command: string; args: string[]; result: CommandResult }

export async function localFacts(
  options: RetrospectiveFactsOptions,
  execute: CommandExecutor,
): Promise<string> {
  const calls: Captured[] = []
  const run = async (command: string, args: string[]): Promise<CommandResult> => {
    const result = await execute(command, args)
    calls.push({ command, args, result })
    return result
  }
  const fetch = await run('git', ['fetch', 'origin', 'main:refs/remotes/origin/main'])
  const originMain =
    fetch.ok ||
    (await run('git', ['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main'])).ok
  const branchResult = await run('git', ['branch', '--show-current'])
  const localBranch = text(branchResult) || 'unavailable'
  const selector = options.noPr ? undefined : (options.pr ?? options.branch)
  const ghArgs = selector ? ['pr', 'view', selector, '--json', PR_JSON_FIELDS] : undefined
  const gh = ghArgs ? await run('gh', ghArgs) : undefined
  const data = gh?.ok ? readJson(gh.stdout) : undefined
  const state = options.noPr
    ? 'none'
    : stringField(data, 'state', gh?.ok ? 'unavailable' : gh ? 'gh failed' : 'unavailable')
  const head = stringField(data, 'headRefName')
  const branch =
    options.branch ??
    (options.pr && head !== 'unavailable' ? head : options.noPr ? localBranch : 'unavailable')
  const rangeName =
    options.branch ??
    (!data && localBranch !== 'unavailable' ? localBranch : options.noPr ? 'HEAD' : undefined)
  const resolved = rangeName ? await resolveNamedRef(rangeName, run) : unresolvedRange()
  const range = resolved.range
  const commitsResult =
    !data && range && originMain
      ? await run('git', ['rev-list', '--count', `origin/main..${range}`])
      : undefined
  const diffResult =
    !data && range && originMain
      ? await run('git', ['diff', '--name-only', `origin/main...${range}`])
      : undefined
  const scoped =
    Boolean(
      options.branch &&
      (localBranch !== options.branch || (head !== 'unavailable' && head !== options.branch)),
    ) || Boolean(options.pr && !options.branch && head !== 'unavailable' && head !== localBranch)
  const scope = options.branch ?? `#${options.pr}`
  const status = scoped
    ? undefined
    : await run('git', ['status', '--porcelain', '--untracked-files=normal'])
  const reflog =
    scoped || branch === 'unavailable'
      ? undefined
      : await run('git', ['reflog', 'show', `origin/${branch}`])
  const merge = objectField(data, 'mergeCommit', 'oid')
  const merged = await mergeFact(data, merge, resolved.range, originMain, options, run)
  const filesText = diffResult?.ok ? text(diffResult) : undefined
  const raw = options.raw
    ? `\n=== Raw Command Output ===\n${calls.map((call) => rawBlock(call.command, call.args, call.result)).join('')}`
    : ''
  return format(
    {
      fetch: 'git fetch origin main:refs/remotes/origin/main',
      fetchStatus: fetch.ok ? 'ok' : 'failed',
      fetchNote: `${
        fetch.ok
          ? 'origin/main refreshed'
          : originMain
            ? 'using existing local origin/main ref after failed fetch'
            : 'origin/main unavailable after failed fetch'
      }${resolved.refreshed ? `; origin/${rangeName} refreshed` : ''}`,
      branch,
      pr: options.noPr ? 'none' : stringField(data, 'number'),
      state,
      mergedAt: stringField(data, 'mergedAt'),
      mergeCommit: merge,
      merged,
      commits: data ? 'unavailable' : commitsResult?.ok ? text(commitsResult) : 'unavailable',
      prCommits: data ? count(data, 'commits') : undefined,
      files: data
        ? apiFiles(data)
        : filesText === undefined
          ? 'unavailable'
          : String(lines(filesText).length),
      dirs: data ? dirs(data) : filesText === undefined ? 'unavailable' : topDirs(filesText),
      changeSource: data ? 'api' : 'local',
      remote:
        reflog === undefined
          ? undefined
          : reflog.ok
            ? String(lines(text(reflog)).length)
            : 'unavailable',
      pushes:
        reflog === undefined
          ? undefined
          : reflog.ok
            ? String(lines(text(reflog)).filter((line) => line.includes('update by push')).length)
            : 'unavailable',
      ...(scoped ? { scoped: scope } : {}),
      working:
        status === undefined
          ? undefined
          : status.ok
            ? String(lines(text(status)).length)
            : 'unavailable',
    },
    raw,
  )
}

function text(result: CommandResult): string {
  return result.stdout.trim()
}
function lines(value: string): string[] {
  return value.split('\n').filter(Boolean)
}

async function resolveNamedRef(
  name: string,
  run: (command: string, args: string[]) => Promise<CommandResult>,
): Promise<{ range: string | undefined; refreshed: boolean }> {
  if (name === 'HEAD') return { range: name, refreshed: false }
  if ((await run('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`])).ok)
    return { range: name, refreshed: false }
  const fetch = await run('git', ['fetch', 'origin', `${name}:refs/remotes/origin/${name}`])
  if (!fetch.ok) return { range: undefined, refreshed: false }
  if ((await run('git', ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${name}`])).ok)
    return { range: `origin/${name}`, refreshed: true }
  return { range: undefined, refreshed: false }
}

function unresolvedRange(): { range: undefined; refreshed: false } {
  return { range: undefined, refreshed: false }
}

async function mergeFact(
  data: Record<string, unknown> | undefined,
  merge: string | undefined,
  range: string | undefined,
  originMain: boolean,
  options: RetrospectiveFactsOptions,
  run: (command: string, args: string[]) => Promise<CommandResult>,
): Promise<string> {
  if (merge && originMain) {
    const inOrigin = await run('git', ['merge-base', '--is-ancestor', merge, 'origin/main'])
    if (!inOrigin.ok)
      return inOrigin.exitCode === 1 ? `no (origin/main lacks ${merge})` : 'unavailable'
    const inLocalMain = await run('git', ['merge-base', '--is-ancestor', merge, 'main'])
    if (!inLocalMain.ok && inLocalMain.exitCode === 1)
      options.onWarning?.(
        `Warning: local main lacks PR merge commit ${merge}, but origin/main contains it.`,
      )
    return `yes (origin/main contains ${merge})`
  }
  if (!data && range && originMain) {
    const rangeInOrigin = await run('git', ['merge-base', '--is-ancestor', range, 'origin/main'])
    if (rangeInOrigin.ok) return `yes (origin/main contains ${range})`
    if (rangeInOrigin.exitCode === 1) return `no (origin/main lacks ${range})`
  }
  return 'unavailable'
}
