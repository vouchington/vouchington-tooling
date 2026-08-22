import * as nodeUtil from 'node:util'

import type { ParsedCiLocalArgs } from './types.mts'

export function parseCiLocalArgs(
  args: readonly string[],
  targetNames: readonly string[],
  parseArgs: typeof nodeUtil.parseArgs = nodeUtil.parseArgs,
): ParsedCiLocalArgs {
  const helpArgs = args.filter((arg) => arg === '-h' || arg === '--help')
  const help = helpArgs.length === 1 && args.length === 1
  if (helpArgs.length > 0 && !help) throw new Error('help must be used by itself')
  if (
    args.filter((arg) => arg === '--dry-run').length > 1 ||
    args.filter((arg) => arg === '--list').length > 1
  ) {
    throw new Error('Options may only be specified once.')
  }

  let dryRun: boolean
  let list: boolean
  let positionals: string[]
  try {
    const parsed = parseArgs({
      args: [...args],
      options: {
        'dry-run': { type: 'boolean' },
        help: { short: 'h', type: 'boolean' },
        list: { type: 'boolean' },
      },
      strict: true,
      allowPositionals: true,
    })
    dryRun = parsed.values['dry-run'] ?? false
    list = parsed.values.list ?? false
    positionals = parsed.positionals
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error), { cause: error })
  }

  if (positionals.length > 1) throw new Error('Only one target may be specified.')
  if (list && (dryRun || positionals.length > 0)) throw new Error('--list must be used by itself.')
  const target = positionals[0]
  if (dryRun && !target) throw new Error('--dry-run requires a target.')

  if (target && !targetNames.includes(target)) {
    throw new Error(`Unknown target "${target}". Valid targets: ${targetNames.join(', ')}`)
  }

  return target ? { dryRun, help, list, target } : { dryRun, help, list }
}
