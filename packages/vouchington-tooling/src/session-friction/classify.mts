import { normalizeCommandPrefix } from './normalize.mts'
import { normalizeAuditText } from './text.mts'
import type { FrictionEvent, FrictionObservation } from './types.mts'

const FAILURE_TOKENS: [string, RegExp][] = [
  ['Operation not permitted', /Operation not permitted/i],
  ['E2BIG', /\bE2BIG\b/i],
  ['EPERM', /\bEPERM\b/i],
]
const CONNECTION_REFUSED = /\bECONNREFUSED\b/i
const IPV4_OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d{2}|[1-9]?\\d)'
const LOOPBACK_ADDRESS = new RegExp(
  String.raw`\b(?:127\.${IPV4_OCTET}(?:\.${IPV4_OCTET}){2}|localhost)\b|` +
    String.raw`(?<![0-9a-z:])\[?(?:::1|0:0:0:0:0:0:0:1)(?:%[a-z0-9_.-]+)?\]?(?![0-9a-z:])`,
  'i',
)
const DETAIL_MAX_LENGTH = 1_000

function boundedDetail(value: string): string {
  return value.slice(0, DETAIL_MAX_LENGTH)
}

export function classifyFrictionObservation(
  observation: FrictionObservation,
): Omit<FrictionEvent, 'timestamp'> | null {
  if (observation.command === '') return null
  const commandPrefix = normalizeCommandPrefix(observation.command, observation.commandWrappers)
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
