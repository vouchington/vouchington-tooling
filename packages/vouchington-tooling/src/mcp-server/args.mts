export type Args = Record<string, unknown>

export function requireObject(value: unknown): Args {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('tool arguments must be an object')
  return value as Args
}

export function rejectUnknown(args: Args, allowed: Iterable<string>): void {
  const known = new Set(allowed)
  const extra = Object.keys(args).filter((key) => !known.has(key))
  if (extra.length) throw new Error(`unsupported argument(s): ${extra.join(', ')}`)
}

export function requiredString(args: Args, name: string): string {
  const value = args[name]
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`${name} is required and must be a non-empty string`)
  return value
}

export function optionalString(args: Args, name: string): string | undefined {
  return args[name] === undefined ? undefined : requiredString(args, name)
}

export function requiredNullableString(args: Args, name: string): string | null {
  if (args[name] === null) return null
  const value = args[name]
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`${name} is required: a non-empty string, or null for none`)
  return value
}

export function requiredChoice<T extends string>(
  args: Args,
  name: string,
  choices: readonly T[],
): T {
  const value = args[name]
  if (typeof value !== 'string' || !choices.includes(value as T))
    throw new Error(`${name} is required and must be one of: ${choices.join(', ')}`)
  return value as T
}

export function requiredStringArray(args: Args, name: string): string[] {
  const value = args[name]
  if (!Array.isArray(value) || !value.length || value.some((item) => typeof item !== 'string'))
    throw new Error(`${name} is required and must be a non-empty array of strings`)
  return value as string[]
}

export function optionalRecord(args: Args, name: string): Args | undefined {
  const value = args[name]
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error(`${name} must be an object`)
  return value as Args
}
