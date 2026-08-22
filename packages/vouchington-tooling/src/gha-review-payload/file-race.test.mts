import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MAX_REVIEW_PAYLOAD_BYTES, ReviewPayloadError } from './payload.mts'

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {
    ...actual,
    readFileSync: vi.fn(() => Buffer.alloc(MAX_REVIEW_PAYLOAD_BYTES + 1)),
  }
})

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

describe('review payload read races', () => {
  it('rechecks the byte count after descriptor reads', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gha-review-payload-race-'))
    roots.push(root)
    const source = join(root, 'payload.json')
    writeFileSync(source, '{}')
    const { readRegularReviewPayload } = await import('./file.mts')
    expect(() => readRegularReviewPayload(source, 'required')).toThrow(ReviewPayloadError)
  })
})
