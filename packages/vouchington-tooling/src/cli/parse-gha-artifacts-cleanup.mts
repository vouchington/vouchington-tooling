export type ParsedGhaArtifactsCleanup = {
  kind: 'gha-artifacts-cleanup'
  subcommand: 'run' | 'sweep'
  runId?: string
  olderThanHours?: number
  keepPatterns: string[]
  deletePatterns: string[]
  patternsFile?: string
}

export function parseGhaArtifactsCleanup(
  args: readonly string[],
): ParsedGhaArtifactsCleanup | { kind: 'help' } | { kind: 'error'; message: string } {
  const [subcommand, ...rest] = args
  if (subcommand === '--help' || subcommand === '-h' || subcommand === undefined) {
    return subcommand === undefined
      ? { kind: 'error', message: 'gha-artifacts-cleanup requires run or sweep' }
      : { kind: 'help' }
  }
  if (subcommand !== 'run' && subcommand !== 'sweep') {
    return { kind: 'error', message: `unknown gha-artifacts-cleanup subcommand: ${subcommand}` }
  }

  let runId: string | undefined
  let olderThanHours: number | undefined
  let patternsFile: string | undefined
  const keepPatterns: string[] = []
  const deletePatterns: string[] = []

  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index]
    if (flag === '--help' || flag === '-h') return { kind: 'help' }
    if (flag === '--run-id' || flag === '--older-than-hours' || flag === '--patterns-file') {
      const value = rest[index + 1]
      if (value === undefined) return { kind: 'error', message: `${flag} requires a value` }
      index += 1
      if (flag === '--run-id') runId = value
      else if (flag === '--patterns-file') patternsFile = value
      else {
        const parsed = Number(value.trim())
        if (!value.trim() || !Number.isFinite(parsed) || parsed < 0) {
          return { kind: 'error', message: '--older-than-hours must be a non-negative number' }
        }
        olderThanHours = parsed
      }
      continue
    }
    if (flag === '--keep-pattern' || flag === '--delete-pattern') {
      const value = rest[index + 1]
      if (value === undefined) return { kind: 'error', message: `${flag} requires a value` }
      index += 1
      if (flag === '--keep-pattern') keepPatterns.push(value)
      else deletePatterns.push(value)
      continue
    }
    return { kind: 'error', message: `unknown gha-artifacts-cleanup option: ${flag}` }
  }

  if (subcommand === 'run') {
    if (!runId) return { kind: 'error', message: 'gha-artifacts-cleanup run requires --run-id' }
    return {
      kind: 'gha-artifacts-cleanup',
      subcommand: 'run',
      runId,
      keepPatterns,
      deletePatterns,
      ...(patternsFile === undefined ? {} : { patternsFile }),
    }
  }
  if (olderThanHours === undefined) {
    return { kind: 'error', message: 'gha-artifacts-cleanup sweep requires --older-than-hours' }
  }
  return {
    kind: 'gha-artifacts-cleanup',
    subcommand: 'sweep',
    olderThanHours,
    keepPatterns,
    deletePatterns,
    ...(patternsFile === undefined ? {} : { patternsFile }),
  }
}
