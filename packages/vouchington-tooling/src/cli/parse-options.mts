import type { ParsedCli } from './parse.mts'

type ParsedOptions = {
  values: Record<string, string | undefined>
  workflowDirectories: string[]
  actionDirectories: string[]
}

export function parseLinkSkill(args: readonly string[]): ParsedCli {
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

export function parseRunnerPortPolicy(args: readonly string[]): ParsedCli {
  const options = parseOptions(args, ['file', 'reserved'], 'runner-port-policy', (flag) =>
    flag === '--reserved' ? 'port' : 'path',
  )
  if ('kind' in options) return options
  const file = options.values.file
  const reservedValue = options.values.reserved
  const reserved = reservedValue === undefined ? undefined : Number(reservedValue)
  if (reservedValue !== undefined && !Number.isInteger(reserved)) {
    return { kind: 'error', message: '--reserved must be an integer' }
  }
  return {
    kind: 'runner-port-policy',
    ...(file === undefined ? {} : { file }),
    ...(reserved === undefined ? {} : { reserved }),
  }
}

export function parseHttpOrigin(args: readonly string[]): ParsedCli {
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

export function parseRequireUpToDate(args: readonly string[]): ParsedCli {
  const options = parseOptions(args, ['remote', 'branch'], 'require-up-to-date', 'name')
  if ('kind' in options) return options
  const remote = options.values.remote
  const branch = options.values.branch
  if (remote === undefined) return { kind: 'error', message: '--remote requires a name' }
  if (branch === undefined) return { kind: 'error', message: '--branch requires a name' }
  return { kind: 'require-up-to-date', remote, branch }
}

export function parseGitleaksDirectoryScan(args: readonly string[]): ParsedCli {
  const options = parseOptions(args, ['config', 'directory'], 'gitleaks-directory-scan', 'path')
  if ('kind' in options) return options
  const config = options.values.config
  const directory = options.values.directory
  if (config === undefined) return { kind: 'error', message: '--config requires a path' }
  return {
    kind: 'gitleaks-directory-scan',
    config,
    ...(directory === undefined ? {} : { directory }),
  }
}

export function parseAstGrepExamples(args: readonly string[]): ParsedCli {
  const options = parseOptions(args, ['rules', 'config'], 'ast-grep-examples', 'path')
  if ('kind' in options) return options
  const rules = options.values.rules
  const config = options.values.config
  if (rules === undefined) return { kind: 'error', message: '--rules requires a path' }
  if (config === undefined) return { kind: 'error', message: '--config requires a path' }
  return { kind: 'ast-grep-examples', rules, config }
}

export function parseGhaWorkspacePolicy(args: readonly string[]): ParsedCli {
  const options = parseOptions(
    args,
    ['root', 'workflow-directory', 'action-directory'],
    'gha-workspace-policy',
    'path',
  )
  if ('kind' in options) return options
  const root = options.values.root
  return {
    kind: 'gha-workspace-policy',
    ...(root === undefined ? {} : { root }),
    ...(options.workflowDirectories.length === 0
      ? {}
      : { workflowDirectories: options.workflowDirectories }),
    ...(options.actionDirectories.length === 0
      ? {}
      : { actionDirectories: options.actionDirectories }),
  }
}

function parseOptions(
  args: readonly string[],
  allowed: readonly string[],
  command: string,
  missingValue: string | ((flag: string) => string),
): ParsedOptions | Extract<ParsedCli, { kind: 'error' | 'help' }> {
  const result: ParsedOptions = { values: {}, workflowDirectories: [], actionDirectories: [] }
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
