import type { CommandResult, RetrospectiveFactsOptions } from './shared.mts'

export async function mergeFact(
  data: Record<string, unknown> | undefined,
  state: string,
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
  if (data && (state === 'OPEN' || state === 'CLOSED')) return 'unmerged at time of retro'
  if (!data && range && originMain) {
    const rangeInOrigin = await run('git', ['merge-base', '--is-ancestor', range, 'origin/main'])
    if (rangeInOrigin.ok) return `yes (origin/main contains ${range})`
    if (rangeInOrigin.exitCode === 1) return `no (origin/main lacks ${range})`
  }
  return 'unavailable'
}
