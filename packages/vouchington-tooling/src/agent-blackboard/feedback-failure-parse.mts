import { isObject } from './snapshot-partition-guards.mts'
import {
  CAUSE,
  CODE,
  type FeedbackCause,
  type FeedbackFailure,
  type FeedbackRejection,
} from './feedback-failure.mts'

// Parsers for the failure and rejection metadata persisted in outbox records.

function integer(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : undefined
}

function parseCause(value: Record<string, unknown>): Partial<FeedbackCause> {
  const { cause, httpStatus, code } = value
  const status = httpStatus === undefined ? undefined : integer(httpStatus, 100, 599)
  if (
    (cause !== undefined && !(typeof cause === 'string' && CAUSE.test(cause))) ||
    (code !== undefined && !(typeof code === 'string' && CODE.test(code))) ||
    (httpStatus !== undefined && status === undefined)
  )
    throw new Error('invalid feedback outbox failure')
  return {
    ...(typeof cause === 'string' ? { cause } : {}),
    ...(status === undefined ? {} : { httpStatus: status }),
    ...(typeof code === 'string' ? { code } : {}),
  }
}

export function parseFailure(value: unknown): FeedbackFailure {
  const attempts = isObject(value) ? integer(value.attempts, 1, 1000) : undefined
  if (!isObject(value) || attempts === undefined || typeof value.cause !== 'string')
    throw new Error('invalid feedback outbox failure')
  return { ...(parseCause(value) as FeedbackCause), attempts }
}

export function parseRejection(value: unknown): FeedbackRejection {
  if (!isObject(value) || typeof value.diagnostic !== 'string' || !CAUSE.test(value.diagnostic))
    throw new Error('invalid feedback outbox rejection')
  const attempts = value.attempts === undefined ? undefined : integer(value.attempts, 1, 1000)
  if (value.attempts !== undefined && attempts === undefined)
    throw new Error('invalid feedback outbox rejection')
  return {
    ...parseCause(value),
    diagnostic: value.diagnostic,
    ...(attempts === undefined ? {} : { attempts }),
  }
}
