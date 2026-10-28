import { parseArgs } from 'node:util'

import {
  DEFAULT_CONFIG_PATH,
  DEFAULT_WORKFLOW_ROOT,
  discoverWorkflows,
  loadRunnerPolicyConfig,
} from './discover.mts'
import { evaluateRunnerPolicy, formatRunnerPolicyViolation } from './evaluate.mts'

export const USAGE = 'Usage: vouchington runner-policy [--config <file>] [--root <directory>]'

export interface RunnerPolicyCliOptions {
  output?: Pick<Console, 'error' | 'log'>
}

/** Exit codes: 0 clean, 1 violations or fail-closed input error, 2 usage error. */
export async function runRunnerPolicyCli(
  argv: readonly string[],
  options: RunnerPolicyCliOptions = {},
): Promise<number> {
  const { output = console } = options
  let values
  try {
    ;({ values } = parseArgs({
      args: [...argv],
      options: {
        config: { type: 'string', default: DEFAULT_CONFIG_PATH },
        root: { type: 'string', default: DEFAULT_WORKFLOW_ROOT },
      },
      strict: true,
    }))
  } catch (error) {
    output.error(`${USAGE}\n${(error as Error).message}`)
    return 2
  }
  const empty = (['config', 'root'] as const).find((key) => values[key].trim() === '')
  if (empty !== undefined) {
    output.error(`${USAGE}\n--${empty} requires a non-empty value`)
    return 2
  }
  try {
    const config = await loadRunnerPolicyConfig(values.config)
    const inputs = await discoverWorkflows(values.root)
    const violations = evaluateRunnerPolicy(inputs, config)
    if (violations.length === 0) {
      output.log(`runner-policy: ${String(inputs.length)} workflow file(s) conform`)
      return 0
    }
    output.error(
      `runner-policy: ${String(violations.length)} violation(s)\n` +
        violations.map((violation) => `  - ${formatRunnerPolicyViolation(violation)}`).join('\n'),
    )
    return 1
  } catch (error) {
    output.error(`runner-policy failed: ${(error as Error).message}`)
    return 1
  }
}
