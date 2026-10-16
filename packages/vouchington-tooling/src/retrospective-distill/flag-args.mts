export type ParsedFlagArgs = {
  values: Map<string, string>
  positional: string[]
}

// Walks argv for `--flag value` pairs. A value may itself start with a dash (a file path, say), so
// a missing value is `undefined`, the end-of-options marker, or another recognized flag.
export function parseStringFlags(argv: string[], flags: readonly string[]): ParsedFlagArgs {
  const values = new Map<string, string>()
  const positional: string[] = []
  let optionsEnded = false
  let consumed = -1
  for (const [i, arg] of argv.entries()) {
    if (i === consumed) continue
    if (!optionsEnded && arg === '--') {
      optionsEnded = true
    } else if (!optionsEnded && flags.includes(arg)) {
      const value = argv[i + 1]
      if (value === undefined || value === '--' || flags.includes(value))
        throw new Error(`${arg} requires a value`)
      if (values.has(arg)) throw new Error(`${arg} may only be specified once`)
      values.set(arg, value)
      consumed = i + 1
    } else if (!optionsEnded && arg.startsWith('-')) {
      throw new Error(`unknown option: ${arg}`)
    } else {
      positional.push(arg)
    }
  }
  return { values, positional }
}
