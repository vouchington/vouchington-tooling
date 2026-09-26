type ParsedFlagOptions = {
  values: Record<string, string | undefined>
  workflowDirectories: string[]
  actionDirectories: string[]
}
type FlagOptionFailure = { kind: 'error'; message: string } | { kind: 'help' }
type LinkSkillCli =
  | FlagOptionFailure
  | { kind: 'link-skill'; name: string; sourceRoot: string; targetRoot: string }
type HttpOriginCli = FlagOptionFailure | { kind: 'http-origin'; field: string; value: string }

export function parseLinkSkill(args: readonly string[]): LinkSkillCli {
  const [name, ...flags] = args
  if (name === undefined || name.startsWith('-'))
    return { kind: 'error', message: 'link-skill requires a skill name' }
  const options = parseOptions(flags, ['source-root', 'target-root'], 'link-skill', 'path')
  if ('kind' in options) return options
  const sourceRoot = options.values['source-root']
  const targetRoot = options.values['target-root']
  if (sourceRoot === undefined || targetRoot === undefined) {
    return { kind: 'error', message: 'link-skill requires --source-root and --target-root' }
  }
  return {
    kind: 'link-skill',
    name,
    sourceRoot,
    targetRoot,
  }
}

export function parseHttpOrigin(args: readonly string[]): HttpOriginCli {
  let field = 'origin'
  const values: string[] = []
  let index = 0
  while (index < args.length) {
    const flag = args[index]!
    index += 1
    if (flag === '--help' || flag === '-h') return { kind: 'help' }
    if (flag === '--field') {
      const value = args[index]
      if (value === undefined) return { kind: 'error', message: '--field requires a name' }
      field = value
      index += 1
      continue
    }
    if (flag === '--') {
      values.push(...args.slice(index))
      break
    }
    if (flag.startsWith('-'))
      return { kind: 'error', message: `unknown http-origin option: ${flag}` }
    values.push(flag)
  }
  if (values.length > 1) return { kind: 'error', message: 'http-origin accepts at most one value' }
  return { kind: 'http-origin', field, value: values[0] ?? '' }
}

export function parseOptions(
  args: readonly string[],
  allowed: readonly string[],
  command: string,
  missingValue: string | ((flag: string) => string),
): ParsedFlagOptions | FlagOptionFailure {
  const result: ParsedFlagOptions = { values: {}, workflowDirectories: [], actionDirectories: [] }
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]!
    if (flag === '--help' || flag === '-h') return { kind: 'help' }
    if (!flag.startsWith('--') || !allowed.includes(flag.slice(2))) {
      return { kind: 'error', message: `unknown ${command} option: ${flag}` }
    }
    const value = args[index + 1]
    if (value === undefined) {
      const noun = typeof missingValue === 'string' ? missingValue : missingValue(flag)
      return { kind: 'error', message: `${flag} requires a ${noun}` }
    }
    if (flag === '--workflow-directory') result.workflowDirectories.push(value)
    else if (flag === '--action-directory') result.actionDirectories.push(value)
    else result.values[flag.slice(2)] = value
    index += 1
  }
  return result
}
