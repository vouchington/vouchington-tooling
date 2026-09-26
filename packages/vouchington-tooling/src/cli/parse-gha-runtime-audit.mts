import {
  parseWorkflowNameMatch,
  type RuntimeAuditWorkflowFilter,
} from '../gha-runtime-audit/scope.mts'

export type ParsedGhaRuntimeAudit = {
  kind: 'gha-runtime-audit'
  repository?: string
  branch?: string
  workflows: RuntimeAuditWorkflowFilter[]
  medianFloorSeconds?: number
  medianThresholdSeconds?: number
}

export function parseGhaRuntimeAudit(
  args: readonly string[],
): ParsedGhaRuntimeAudit | { kind: 'help' } | { kind: 'error'; message: string } {
  let repository: string | undefined
  let branch: string | undefined
  let medianFloorSeconds: number | undefined
  let medianThresholdSeconds: number | undefined
  const workflows: RuntimeAuditWorkflowFilter[] = []
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]
    if (flag === '--help' || flag === '-h') return { kind: 'help' }
    if (
      flag === '--repository' ||
      flag === '--pr-workflow' ||
      flag === '--push-workflow' ||
      flag === '--branch' ||
      flag === '--median-threshold-floor' ||
      flag === '--median-threshold-ceiling'
    ) {
      const value = args[index + 1]
      if (value === undefined) return { kind: 'error', message: `${flag} requires a value` }
      index += 1
      if (flag === '--repository') repository = value
      else if (flag === '--branch') branch = value
      else if (flag === '--median-threshold-floor' || flag === '--median-threshold-ceiling') {
        const seconds = parsePositiveSeconds(flag, value)
        if (typeof seconds !== 'number') return seconds
        if (flag === '--median-threshold-floor') medianFloorSeconds = seconds
        else medianThresholdSeconds = seconds
      } else {
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
  const ceiling = medianThresholdSeconds ?? 360
  if (medianFloorSeconds !== undefined && medianFloorSeconds >= ceiling) {
    return {
      kind: 'error',
      message: '--median-threshold-floor must be below the median ceiling',
    }
  }
  return {
    kind: 'gha-runtime-audit',
    workflows,
    ...(repository === undefined ? {} : { repository }),
    ...(branch === undefined ? {} : { branch }),
    ...(medianFloorSeconds === undefined ? {} : { medianFloorSeconds }),
    ...(medianThresholdSeconds === undefined ? {} : { medianThresholdSeconds }),
  }
}

function parsePositiveSeconds(
  flag: string,
  value: string,
): number | { kind: 'error'; message: string } {
  if (!/^[1-9]\d*$/.test(value)) {
    return { kind: 'error', message: `${flag} requires a positive integer` }
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) {
    return { kind: 'error', message: `${flag} requires a positive integer` }
  }
  return parsed
}
