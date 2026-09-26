import type { ParsedCli } from './parse.mts'
import { parseOptions } from './parse-direct-options.mts'

export { parseHttpOrigin, parseLinkSkill } from './parse-direct-options.mts'

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

export function parseAstGrepPack(args: readonly string[]): ParsedCli {
  const options = parseOptions(args, [], 'ast-grep-pack', 'value')
  if ('kind' in options) return options
  return { kind: 'ast-grep-pack' }
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
