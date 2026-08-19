import {
  parseWorkflowNameMatch,
  type RuntimeAuditWorkflowFilter,
} from '../gha-runtime-audit/scope.mts'

export type ParsedGhaRuntimeAudit = {
  kind: 'gha-runtime-audit'
  repository?: string
  branch?: string
  workflows: RuntimeAuditWorkflowFilter[]
}

export function parseGhaRuntimeAudit(
  args: readonly string[],
): ParsedGhaRuntimeAudit | { kind: 'help' } | { kind: 'error'; message: string } {
  let repository: string | undefined
  let branch: string | undefined
  const workflows: RuntimeAuditWorkflowFilter[] = []
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]
    if (flag === '--help' || flag === '-h') return { kind: 'help' }
    if (
      flag === '--repository' ||
      flag === '--pr-workflow' ||
      flag === '--push-workflow' ||
      flag === '--branch'
    ) {
      const value = args[index + 1]
      if (value === undefined) return { kind: 'error', message: `${flag} requires a value` }
      index += 1
      if (flag === '--repository') repository = value
      else if (flag === '--branch') branch = value
      else {
        workflows.push({
          name: parseWorkflowNameMatch(value),
          event: flag === '--pr-workflow' ? 'pull_request' : 'push',
        })
      }
      continue
    }
    return { kind: 'error', message: `unknown gha-runtime-audit option: ${flag}` }
  }
  if (workflows.length === 0) {
    return {
      kind: 'error',
      message: 'gha-runtime-audit requires --pr-workflow or --push-workflow',
    }
  }
  return {
    kind: 'gha-runtime-audit',
    workflows,
    ...(repository === undefined ? {} : { repository }),
    ...(branch === undefined ? {} : { branch }),
  }
}
