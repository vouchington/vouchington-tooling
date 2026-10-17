import { inspectHarnessEnvironment as inspect, type HarnessEnvironment } from 'agent-blackboard'

export { HARNESS_IDS, selectHarnessSession } from 'agent-blackboard'
export type { HarnessEnvironment, HarnessId, HarnessSessionIdentity } from 'agent-blackboard'

export function inspectHarnessEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): HarnessEnvironment {
  return inspect(env)
}
