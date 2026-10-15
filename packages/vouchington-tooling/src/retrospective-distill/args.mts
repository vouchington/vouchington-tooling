import { parseStringFlags } from './flag-args.mts'

export type DistillClassifyArgs = {
  partitionPath: string
  retroCutoff: string
  sessionCutoff: string
}

function requireIsoCutoff(value: string | undefined, flag: string): string {
  if (value === undefined) throw new Error(`${flag} is required`)
  if (Number.isNaN(Date.parse(value))) throw new Error(`${flag} must be a valid ISO 8601 timestamp`)
  return value
}

/**
 * Parses `<partition.jsonl> --retro-cutoff <iso> --session-cutoff <iso>`.
 *
 * The classifier never computes its own cutoffs: the eligibility rule is evaluated against
 * whatever `retroCutoff`/`sessionCutoff` the caller passes in, so a classifier run always matches
 * the caller's own idea of "eligible" for that same run.
 */
export function parseDistillClassifyArgs(argv: string[]): DistillClassifyArgs {
  const { values, positional } = parseStringFlags(argv, ['--retro-cutoff', '--session-cutoff'])
  const [partitionPath, ...extra] = positional
  if (partitionPath === undefined || extra.length > 0) {
    throw new Error('expected exactly one positional argument: the partition JSONL path')
  }
  return {
    partitionPath,
    retroCutoff: requireIsoCutoff(values.get('--retro-cutoff'), '--retro-cutoff'),
    sessionCutoff: requireIsoCutoff(values.get('--session-cutoff'), '--session-cutoff'),
  }
}
