import type { ParsedCli } from './parse.mts'
import { parseOptions } from './parse-direct-options.mts'

export function parseFreshBase(args: readonly string[]): ParsedCli {
  const skipFetch = args.includes('--skip-fetch')
  const rest = args.filter((arg) => arg !== '--skip-fetch')
  const options = parseOptions(rest, ['remote', 'branch'], 'fresh-base', 'name')
  if ('kind' in options) return options
  const { remote, branch } = options.values
  return {
    kind: 'fresh-base',
    skipFetch,
    ...(remote === undefined ? {} : { remote }),
    ...(branch === undefined ? {} : { branch }),
  }
}
