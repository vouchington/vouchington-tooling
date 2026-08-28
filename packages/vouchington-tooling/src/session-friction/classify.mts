import { normalizeCommandPrefix } from './normalize.mts'
import { normalizeAuditText } from './text.mts'
import type { FrictionEvent, FrictionObservation } from './types.mts'

const FAILURE_TOKENS: [string, RegExp][] = [
  ['Operation not permitted', /Operation not permitted/i],
  ['E2BIG', /\bE2BIG\b/],
  ['EPERM', /\bEPERM\b/],
]
const CONNECTION_REFUSED = /\bECONNREFUSED\b/i
const LOOPBACK_ADDRESS = /\b(?:127\.0\.0\.1|localhost)\b|(?:^|[^0-9a-f:])::1(?=$|[^0-9a-f:])/i
const DETAIL_MAX_LENGTH = 1_000

function boundedDetail(value: string): string {
  return value.slice(0, DETAIL_MAX_LENGTH)
}

export function classifyFrictionObservation(
  observation: FrictionObservation,
): Omit<FrictionEvent, 'timestamp'> | null {
  if (observation.command === '') return null
  const commandPrefix = normalizeCommandPrefix(observation.command)
  if (commandPrefix === '') return null
  if (observation.type === 'permission-request') {
    return { kind: 'sandbox-escalation', commandPrefix, detail: 'permission-request' }
  }
  const escalationDetail = boundedDetail(normalizeAuditText(observation.escalationDetail ?? ''))
  if (escalationDetail) {
    return {
      kind: 'sandbox-escalation',
      commandPrefix,
      detail: escalationDetail,
    }
  }
  const stderr = observation.structuredStderr
  if (stderr === undefined) return null
  const token = FAILURE_TOKENS.find(([, pattern]) => pattern.test(stderr))?.[0]
  if (token) return { kind: 'sandbox-failure', commandPrefix, detail: `stderr matched "${token}"` }
  if (
    stderr
      .split(/\r?\n/)
      .some((line) => CONNECTION_REFUSED.test(line) && LOOPBACK_ADDRESS.test(line))
  ) {
    return {
      kind: 'sandbox-failure',
      commandPrefix,
      detail: 'stderr matched localhost connection failure',
    }
  }
  return null
}
