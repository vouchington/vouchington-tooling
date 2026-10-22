export type ParsedAgentIssueLabels =
  | {
      kind: 'agent-issue-labels'
      subcommand: 'labels-from-paths'
      labeler?: string
      paths: string[]
    }
  | {
      kind: 'agent-issue-labels'
      subcommand: 'ensure-labels'
      repo?: string
      policyFile?: string
      update: boolean
      labels: string[]
    }

type Failure = { kind: 'error'; message: string }
const PREFIX = 'agent-issue-labels'

/** Reads the value after `flag`, rejecting a missing value or another flag. */
function takeValue(args: readonly string[], index: number, flag: string): string | Failure {
  const value = args[index + 1]
  if (value === undefined || value.startsWith('--')) {
    return { kind: 'error', message: `${PREFIX}: ${flag} requires a value` }
  }
  return value
}

export function parseAgentIssueLabels(args: readonly string[]): ParsedAgentIssueLabels | Failure {
  const [subcommand, ...rest] = args
  if (subcommand !== 'labels-from-paths' && subcommand !== 'ensure-labels') {
    return {
      kind: 'error',
      message:
        subcommand === undefined
          ? `${PREFIX} requires labels-from-paths or ensure-labels`
          : `unknown ${PREFIX} subcommand: ${subcommand}`,
    }
  }
  const positional: string[] = []
  const values = new Map<string, string>()
  let update = false
  const allowed = subcommand === 'ensure-labels' ? ['--repo', '--policy-file'] : ['--labeler']
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!
    if (arg === '--update' && subcommand === 'ensure-labels') {
      if (update)
        return { kind: 'error', message: `${PREFIX}: --update may be specified only once` }
      update = true
    } else if (allowed.includes(arg)) {
      if (values.has(arg)) {
        return { kind: 'error', message: `${PREFIX}: ${arg} may be specified only once` }
      }
      const value = takeValue(rest, index, arg)
      if (typeof value !== 'string') return value
      values.set(arg, value)
      index += 1
    } else if (arg.startsWith('--')) {
      return { kind: 'error', message: `unknown ${PREFIX} option: ${arg}` }
    } else {
      positional.push(arg)
    }
  }
  if (subcommand === 'labels-from-paths') {
    const labeler = values.get('--labeler')
    return {
      kind: 'agent-issue-labels',
      subcommand,
      paths: positional,
      ...(labeler === undefined ? {} : { labeler }),
    }
  }
  if (positional.length === 0) {
    return { kind: 'error', message: `${PREFIX} ensure-labels requires at least one label` }
  }
  const repo = values.get('--repo')
  const policyFile = values.get('--policy-file')
  return {
    kind: 'agent-issue-labels',
    subcommand,
    update,
    labels: positional,
    ...(repo === undefined ? {} : { repo }),
    ...(policyFile === undefined ? {} : { policyFile }),
  }
}
