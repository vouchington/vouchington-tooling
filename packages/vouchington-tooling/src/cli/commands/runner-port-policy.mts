import { pathToFileURL } from 'node:url'
import {
  isRunnerReservedPort,
  loadRunnerPortPolicy,
  runnerPortPolicy,
} from '../../runner-port-policy/index.mts'

export function runRunnerPortPolicy(options: { file?: string; reserved?: number }): number {
  const policy = options.file ? loadRunnerPortPolicy(pathToFileURL(options.file)) : runnerPortPolicy
  if (options.reserved !== undefined) {
    process.stdout.write(`${String(isRunnerReservedPort(options.reserved, policy))}\n`)
    return 0
  }
  process.stdout.write(`${JSON.stringify(policy, null, 2)}\n`)
  return 0
}
