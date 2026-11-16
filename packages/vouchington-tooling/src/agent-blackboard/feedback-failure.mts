import { isObject } from './snapshot-partition-guards.mts'

/**
 * Why one delivery attempt failed, in a closed vocabulary with no messages, URLs, headers, or bodies
 * so it can never echo a secret: `network`, `timeout`, `http-5xx`, `http-4xx`, `http-401`,
 * `http-403`, `http-408`, `http-429`, `missing-env:<NAME>`, `invalid-url`, `client-unavailable`,
 * `error:<ClassName>`, or the diagnostic itself for conflicts and archived sessions.
 */
export type FeedbackCause = { cause: string; httpStatus?: number; code?: string }
/** A pending record's persisted failure; `attempts` counts consecutive flushes with this cause. */
export type FeedbackFailure = FeedbackCause & { attempts: number }
/** What a `.rejected` record keeps about why it was refused. */
export type FeedbackRejection = Partial<FeedbackCause> & { diagnostic: string; attempts?: number }

export const QUARANTINE_ATTEMPTS = 5
/** The highest persisted attempt count; later attempts saturate here. */
export const MAX_ATTEMPTS = 1000
export const CAUSE = /^[A-Za-z0-9_:.-]{1,80}$/
export const CODE = /^[A-Z][A-Z0-9_]{1,40}$/
// Healing without touching the record: outages, throttling, credentials, and the environment.
const HEALS = /^(network|timeout|http-5xx|http-(401|403|408|429)|missing-env:.*|invalid-url)$/
const HEALS_TOO = /^(client-unavailable|readback-unconfirmed|delivery-timeout)$/

/** Transient or environmental causes never quarantine; only a record-specific cause can. */
export function isTransientCause(cause: string): boolean {
  return HEALS.test(cause) || HEALS_TOO.test(cause)
}

/** A missing connection variable is named; any other configuration fault is an invalid URL. */
export function configurationCause(env: NodeJS.ProcessEnv = process.env): FeedbackCause {
  const name = ['AGENT_BLACKBOARD_URL', 'AGENT_BLACKBOARD_TOKEN'].find((key) => !env[key])
  return { cause: name === undefined ? 'invalid-url' : `missing-env:${name}` }
}

export function statusCause(status: number): FeedbackCause {
  if (status >= 500) return { cause: 'http-5xx', httpStatus: status }
  const exact = [401, 403, 408, 429].includes(status)
  return {
    cause: exact ? `http-${status}` : status >= 400 ? 'http-4xx' : 'http-other',
    httpStatus: status,
  }
}

/** Classifies a raw delivery error. Only the status, the error name, and a system code are read. */
export function causeOfError(error: unknown): FeedbackCause {
  if (!isObject(error)) return { cause: 'error:unknown' }
  const status = error.status ?? error.statusCode
  if (typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599)
    return statusCause(status)
  const nested = isObject(error.cause) ? error.cause : undefined
  const raw = error.code ?? nested?.code
  const code = typeof raw === 'string' && CODE.test(raw) ? raw : undefined
  const { name, message } = error
  if (code !== undefined) return { cause: 'network', code }
  if (name === 'TypeError' && message === 'fetch failed') return { cause: 'network' }
  return {
    cause:
      typeof name === 'string' && /^[A-Za-z0-9]{1,40}$/.test(name)
        ? `error:${name}`
        : 'error:unknown',
  }
}
