import { dumpHarnessPolicy } from './policy.mts'
import { applyHarnessConfig, checkHarnessConfig } from './apply.mts'
import { HARNESS_IDS, type ApplyTarget, type HarnessId, type KeyDrift } from './types.mts'

const AGENT_HARNESS_CONFIG_USAGE =
  'agent-harness-config dump|check|apply [--global] [--repo PATH]... [--harness NAME]... [--home PATH]'

export interface ParsedAgentHarnessConfig {
  readonly action: 'dump' | 'check' | 'apply'
  readonly harnesses?: readonly HarnessId[]
  readonly home?: string
  readonly repos: readonly string[]
  readonly global: boolean
}

function isHarness(value: string): value is HarnessId {
  return (HARNESS_IDS as readonly string[]).includes(value)
}

export function parseAgentHarnessConfigArguments(
  argv: readonly string[],
): ParsedAgentHarnessConfig {
  const action = argv[0]
  if (action !== 'dump' && action !== 'check' && action !== 'apply') {
    throw new Error(
      `unknown agent-harness-config action: ${action ?? ''}\n${AGENT_HARNESS_CONFIG_USAGE}`,
    )
  }
  let global = false
  let home: string | undefined
  const repos: string[] = []
  const harnesses: HarnessId[] = []
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--global') {
      global = true
      continue
    }
    if (flag === '--repo' || flag === '--harness' || flag === '--home') {
      const value = argv[index + 1]
      if (value === undefined)
        throw new Error(`${flag} requires a value\n${AGENT_HARNESS_CONFIG_USAGE}`)
      index += 1
      if (flag === '--repo') repos.push(value)
      else if (flag === '--home') home = value
      else if (!isHarness(value)) throw new Error(`unknown harness: ${value}`)
      else harnesses.push(value)
      continue
    }
    throw new Error(`unknown agent-harness-config option: ${flag}\n${AGENT_HARNESS_CONFIG_USAGE}`)
  }
  if (action !== 'dump' && !global && repos.length === 0) {
    throw new Error(`check and apply require --global and/or --repo\n${AGENT_HARNESS_CONFIG_USAGE}`)
  }
  return {
    action,
    global,
    repos,
    ...(harnesses.length > 0 ? { harnesses } : {}),
    ...(home === undefined ? {} : { home }),
  }
}

function formatDrift(drift: KeyDrift): string {
  return `  ${drift.path} ${drift.key}: ${JSON.stringify(drift.current)} -> ${JSON.stringify(drift.desired)}`
}

function targets(parsed: ParsedAgentHarnessConfig): ApplyTarget[] {
  const list: ApplyTarget[] = []
  if (parsed.global) list.push({ kind: 'global' })
  for (const root of parsed.repos) list.push({ kind: 'repo', root })
  return list
}

export async function runAgentHarnessConfigCli(argv: readonly string[]): Promise<number> {
  try {
    const parsed = parseAgentHarnessConfigArguments(argv)
    if (parsed.action === 'dump') {
      process.stdout.write(`${JSON.stringify(dumpHarnessPolicy(), null, 2)}\n`)
      return 0
    }
    const options = {
      ...(parsed.harnesses === undefined ? {} : { harnesses: parsed.harnesses }),
      ...(parsed.home === undefined ? {} : { home: parsed.home }),
    }
    let compliant = true
    for (const target of targets(parsed)) {
      const result =
        parsed.action === 'apply'
          ? await applyHarnessConfig(target, options)
          : await checkHarnessConfig(target, options)
      compliant &&= result.files.every((file) => file.action === 'ok')
      for (const file of result.files) {
        if (file.action === 'ok') process.stdout.write(`ok ${file.path}\n`)
        else process.stdout.write(`${file.action} ${file.path}\n`)
        for (const drift of file.drifts) process.stdout.write(`${formatDrift(drift)}\n`)
      }
    }
    return parsed.action === 'apply' || compliant ? 0 : 1
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 2
  }
}
