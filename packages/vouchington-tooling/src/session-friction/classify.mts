import { normalizeCommandPrefix } from './normalize.mts'
import { boundedText, normalizeAuditText } from './text.mts'
import type { FrictionEvent, FrictionObservation } from './types.mts'

const FAILURE_TOKENS: [string, RegExp][] = [
  ['Operation not permitted', /Operation not permitted/i],
  ['E2BIG', /\bE2BIG\b/i],
  ['EPERM', /\bEPERM\b/i],
]
const CONNECTION_REFUSED = /\bECONNREFUSED\b/i
const STDERR_INSPECTION_MAX_LENGTH = 100_000
const COMMAND_INSPECTION_MAX_LENGTH = 10_000
const IPV4_OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d{2}|[1-9]?\\d)'
const LOOPBACK_ADDRESSES = [
  new RegExp(
    String.raw`(?<![0-9a-z_.-])(?:127\.${IPV4_OCTET}(?:\.${IPV4_OCTET}){2}|localhost)(?![0-9a-z_.-])`,
    'i',
  ),
  /(?<![0-9a-z_.-])\[(?:::1|0:0:0:0:0:0:0:1)(?:%[a-z0-9_.-]+)?\](?![0-9a-z_.-])/i,
  /(?<![0-9a-z_.:\x5b\x5d-])(?:::1|0:0:0:0:0:0:0:1)(?:%[a-z0-9_.-]+)?(?::\d{1,5})?(?![0-9a-z_.:\x5b\x5d-])/i,
]
const DETAIL_MAX_LENGTH = 1_000

function boundedStderr(value: string): string {
  if (value.length <= STDERR_INSPECTION_MAX_LENGTH) return value
  const headLength = Math.floor((STDERR_INSPECTION_MAX_LENGTH - 1) / 2)
  const tailLength = STDERR_INSPECTION_MAX_LENGTH - 1 - headLength
  return `${value.slice(0, headLength)}\n${value.slice(-tailLength)}`
}

export function classifyFrictionObservation(
  observation: FrictionObservation,
): Omit<FrictionEvent, 'timestamp'> | null {
  if (typeof observation.command !== 'string') return null
  const command = boundedText(observation.command, COMMAND_INSPECTION_MAX_LENGTH)
  if (normalizeAuditText(command) === '') return null
  const commandPrefix = normalizeCommandPrefix(command, observation.commandWrappers)
  if (commandPrefix === '') return null
  if (observation.type === 'permission-request') {
    return { kind: 'sandbox-escalation', commandPrefix, detail: 'permission-request' }
  }
  if (
    observation.escalationDetail !== undefined &&
    typeof observation.escalationDetail !== 'string'
  )
    return null
  const escalationDetail = normalizeAuditText(
    boundedText(observation.escalationDetail ?? '', DETAIL_MAX_LENGTH),
  )
  if (escalationDetail) {
    return {
      kind: 'sandbox-escalation',
      commandPrefix,
      detail: escalationDetail,
    }
  }
  const rawStderr = observation.structuredStderr
  if (rawStderr !== undefined && typeof rawStderr !== 'string') return null
  const stderr = rawStderr ? boundedStderr(rawStderr) : rawStderr
  if (stderr === undefined) return null
  const token = FAILURE_TOKENS.find(([, pattern]) => pattern.test(stderr))?.[0]
  if (token) return { kind: 'sandbox-failure', commandPrefix, detail: `stderr matched "${token}"` }
  if (
    stderr
      .split(/\r\n|[\r\n]/)
      .some(
        (line) =>
          CONNECTION_REFUSED.test(line) && LOOPBACK_ADDRESSES.some((pattern) => pattern.test(line)),
      )
  ) {
    return {
      kind: 'sandbox-failure',
      commandPrefix,
      detail: 'stderr matched localhost connection failure',
    }
  }
  return null
}
