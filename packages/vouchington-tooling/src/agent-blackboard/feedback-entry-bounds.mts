import { FeedbackDeliveryError } from './feedback-online-error.mts'

const MAX_ENTRIES = 10_000
const MAX_BYTES = 2_000_000

/** Yields a session's entries, refusing to read an unbounded history. */
export async function* boundedEntries(entries: AsyncIterable<unknown>): AsyncGenerator<unknown> {
  let count = 0
  let inspectedBytes = 0
  for await (const entry of entries) {
    inspectedBytes += Buffer.byteLength(JSON.stringify(entry))
    if (++count > MAX_ENTRIES || inspectedBytes > MAX_BYTES)
      throw new FeedbackDeliveryError('readback-unconfirmed')
    yield entry
  }
}
