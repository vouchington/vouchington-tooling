import { normalizeCommandPrefix } from './normalize.mts'
import type { FrictionEvent, FrictionObservation } from './types.mts'

const FAILURE_TOKENS = ['Operation not permitted', 'E2BIG', 'EPERM']
const LOCALHOST_FAILURE = /ECONNREFUSED.*(127\.0\.0\.1|::1|localhost)|connect ECONNREFUSED/i

export function classifyFrictionObservation(
  observation: FrictionObservation,
): Omit<FrictionEvent, 'timestamp'> | null {
  if (observation.command === '') return null
  const commandPrefix = normalizeCommandPrefix(observation.command)
  if (commandPrefix === '') return null
  if (observation.type === 'permission-request') {
    return { kind: 'sandbox-escalation', commandPrefix, detail: 'permission-request' }
  }
  if (observation.escalationDetail !== undefined) {
    return {
      kind: 'sandbox-escalation',
      commandPrefix,
      detail: observation.escalationDetail,
    }
  }
  const stderr = observation.structuredStderr
  if (stderr === undefined) return null
  const token = FAILURE_TOKENS.find((value) => stderr.includes(value))
  if (token) return { kind: 'sandbox-failure', commandPrefix, detail: `stderr matched "${token}"` }
  if (LOCALHOST_FAILURE.test(stderr)) {
    return {
      kind: 'sandbox-failure',
      commandPrefix,
      detail: 'stderr matched localhost connection failure',
    }
  }
  return null
}
