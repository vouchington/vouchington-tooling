import {
  applyFlag,
  emptyParsed,
  missingField,
  type ParsedStoryCoverage,
} from './parse-story-coverage-fields.mts'

export type { ParsedStoryCoverage }

const FLAGS = new Set([
  '--root',
  '--component-root',
  '--story-root',
  '--alias',
  '--source-extension',
  '--component-extension',
  '--marker',
  '--story-pattern',
  '--exclusions',
  '--exclusions-label',
])

export function parseStoryCoverage(
  args: readonly string[],
): ParsedStoryCoverage | { kind: 'help' } | { kind: 'error'; message: string } {
  if (args.length === 0) return { kind: 'error', message: 'story-coverage requires --root' }
  if (args.includes('--help') || args.includes('-h')) return { kind: 'help' }
  const parsed = emptyParsed()
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index] ?? ''
    if (!FLAGS.has(flag))
      return { kind: 'error', message: `unknown story-coverage option: ${flag}` }
    const value = args[index + 1]
    if (value === undefined || value.startsWith('--')) {
      return { kind: 'error', message: `${flag} requires a value` }
    }
    index += 1
    const invalid = applyFlag(parsed, flag, value)
    if (invalid) return { kind: 'error', message: invalid }
  }
  return missingField(parsed) ?? parsed
}
