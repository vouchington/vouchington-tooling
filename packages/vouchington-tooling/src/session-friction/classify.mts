import { normalizeCommandPrefix } from './normalize.mts'
import { boundedText, isWellFormedUnicode, normalizeAuditText } from './text.mts'
import type { FrictionEvent, FrictionObservation } from './types.mts'

const FAILURE_TOKENS: [string, RegExp][] = [
  ['Operation not permitted', /Operation not permitted/i],
  ['E2BIG', /\bE2BIG\b/i],
  ['EPERM', /\bEPERM\b/i],
]
const CONNECTION_REFUSED = /\bECONNREFUSED\b/i
const URL_USERINFO = /([a-z][a-z0-9+.-]{0,31}:\/\/)[^\s/?#@]*@/gi
const STDERR_INSPECTION_MAX_LENGTH = 100_000
const COMMAND_INSPECTION_MAX_LENGTH = 10_000
const IPV4_OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d{2}|[1-9]?\\d)'
const LOOPBACK_ADDRESSES = [
  new RegExp(
    String.raw`(?<![0-9a-z_.:-])(?:127\.${IPV4_OCTET}(?:\.${IPV4_OCTET}){2}|localhost)(?![0-9a-z_.-])`,
    'i',
  ),
  /(?<![0-9a-z_.-])\[(?:::1|0:0:0:0:0:0:0:1)(?:%[a-z0-9_.-]+)?\](?![0-9a-z_.-])/i,
  /(?<![0-9a-z_.:\x5b\x5d-])(?:::1|0:0:0:0:0:0:0:1)(?:%[a-z0-9_.-]+)?(?::\d{1,5})?(?![0-9a-z_.:\x5b\x5d-])/i,
]
const DETAIL_MAX_LENGTH = 1_000

function boundedTail(value: string, maximum: number): string {
  let start = Math.max(0, value.length - maximum)
  const first = value.charCodeAt(start)
  const previous = value.charCodeAt(start - 1)
  if (first >= 0xdc00 && first <= 0xdfff && previous >= 0xd800 && previous <= 0xdbff) start++
  return value.slice(start)
}

function boundedStderr(value: string): string {
  if (value.length <= STDERR_INSPECTION_MAX_LENGTH) return value
  const headLength = Math.floor((STDERR_INSPECTION_MAX_LENGTH - 1) / 2)
  const head = boundedText(value, headLength)
  const tail = boundedTail(value, STDERR_INSPECTION_MAX_LENGTH - 1 - head.length)
  return `${head}\n${tail}`
}

function withoutUrlUserinfo(line: string): string {
  return line.includes('://') && line.includes('@') ? line.replace(URL_USERINFO, '$1') : line
}

export function classifyFrictionObservation(
  observation: FrictionObservation,
): Omit<FrictionEvent, 'timestamp'> | null {
  if (!observation || typeof observation !== 'object') return null
  if (typeof observation.command !== 'string') return null
  const command = boundedText(observation.command, COMMAND_INSPECTION_MAX_LENGTH)
  if (!isWellFormedUnicode(command) || normalizeAuditText(command) === '') return null
  const commandPrefix = normalizeCommandPrefix(command, observation.commandWrappers)
  if (commandPrefix === '' || !isWellFormedUnicode(commandPrefix)) return null
  if (observation.type === 'permission-request') {
    return { kind: 'sandbox-escalation', commandPrefix, detail: 'permission-request' }
  }
  if (observation.type !== 'tool-result') return null
  if (
    observation.escalationDetail !== undefined &&
    typeof observation.escalationDetail !== 'string'
  )
    return null
  const escalationDetail = normalizeAuditText(
    boundedText(observation.escalationDetail ?? '', DETAIL_MAX_LENGTH),
  )
  if (!isWellFormedUnicode(escalationDetail)) return null
  if (escalationDetail) {
    return {
      kind: 'sandbox-escalation',
      commandPrefix,
      detail: escalationDetail,
    }
  }
  const rawStderr = observation.structuredStderr
  if (rawStderr !== undefined && (typeof rawStderr !== 'string' || !isWellFormedUnicode(rawStderr)))
    return null
  const stderr = rawStderr ? boundedStderr(rawStderr) : rawStderr
  if (stderr === undefined) return null
  const token = FAILURE_TOKENS.find(([, pattern]) => pattern.test(stderr))?.[0]
  if (token) return { kind: 'sandbox-failure', commandPrefix, detail: `stderr matched "${token}"` }
  if (
    stderr.split(/\r\n|[\r\n]/).some((rawLine) => {
      const line = withoutUrlUserinfo(rawLine)
      return (
        CONNECTION_REFUSED.test(line) && LOOPBACK_ADDRESSES.some((pattern) => pattern.test(line))
      )
    })
  ) {
    return {
      kind: 'sandbox-failure',
      commandPrefix,
      detail: 'stderr matched localhost connection failure',
    }
  }
  return null
}
