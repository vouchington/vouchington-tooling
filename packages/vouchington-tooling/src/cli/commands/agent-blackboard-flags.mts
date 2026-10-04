export function flagsToValues(flags: string[]): Record<string, string> {
  const values: Record<string, string> = {}
  for (let index = 0; index < flags.length; index += 2) {
    const flag = flags[index]
    const value = flags[index + 1]
    if (!flag?.startsWith('--') || value === undefined)
      throw new Error(`invalid option: ${flag ?? ''}`)
    const key = flag.slice(2)
    if (key in values) throw new Error(`duplicate option: ${flag}`)
    values[key] = value
  }
  return values
}

export function assertAllowed(values: Record<string, string>, allowed: string[]): void {
  for (const key of Object.keys(values))
    if (!allowed.includes(key)) throw new Error(`unknown option: --${key}`)
}

export function required(values: Record<string, string>, key: string): string {
  const value = values[key]
  if (!value) throw new Error(`--${key} is required`)
  return value
}
