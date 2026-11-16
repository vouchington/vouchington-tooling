import { closeSync, constants, fstatSync } from 'node:fs'
import { openLogFile, readLogContent } from '../private-files/log-file.mts'
import { validateFeedbackEnvelope } from './feedback-codec.mts'
import { parseFailure, parseRejection } from './feedback-failure.mts'
import type { FeedbackFailure, FeedbackRejection } from './feedback-failure.mts'
import { validateFeedbackIdentity } from './feedback-identity.mts'
import { isObject } from './snapshot-partition-guards.mts'
import type { FeedbackOutboxRecord } from './feedback-types.mts'

export const RECORD_MAX_BYTES = 18_000
// A stored failure or rejection note rides along with a record at its size limit.
const NOTE_MAX_BYTES = 1_000
const RECORD_KEYS = ['identity', 'envelope', 'failure', 'rejection']

export type LoadedRecord = {
  record: FeedbackOutboxRecord
  bytes: number
  failure?: FeedbackFailure
  rejection?: FeedbackRejection
}

export function readRecord(path: string): LoadedRecord {
  const descriptor = openLogFile(path, constants.O_RDONLY)
  try {
    const bytes = fstatSync(descriptor).size
    const limit = RECORD_MAX_BYTES + NOTE_MAX_BYTES
    if (bytes > limit) throw new Error('feedback outbox record is too large')
    const value: unknown = JSON.parse(readLogContent(descriptor, limit))
    if (!isObject(value) || Object.keys(value).some((key) => !RECORD_KEYS.includes(key)))
      throw new Error('invalid feedback outbox record')
    validateFeedbackIdentity(value.identity)
    validateFeedbackEnvelope(value.envelope)
    return {
      record: { identity: value.identity, envelope: value.envelope },
      bytes,
      ...(value.failure === undefined ? {} : { failure: parseFailure(value.failure) }),
      ...(value.rejection === undefined ? {} : { rejection: parseRejection(value.rejection) }),
    }
  } finally {
    closeSync(descriptor)
  }
}
