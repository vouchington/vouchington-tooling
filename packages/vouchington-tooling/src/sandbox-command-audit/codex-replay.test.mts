import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { scanCodexFile } from './codex-scan.mts'
import { jsonl, limits, tempDir, writeLines } from './fixtures.test-helpers.mts'

const discard = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('./codex-spool.mts', () => ({
  createSpool: async () => ({
    path: '/nonexistent/spool.jsonl',
    write: async () => undefined,
    close: async () => undefined,
    discard,
  }),
}))

describe('scanCodexFile replay', () => {
  it('reports an error when the spool cannot be reopened for replay', async () => {
    const meta = {
      type: 'session_meta',
      payload: { timestamp: '2026-01-01T00:00:10Z', forked_from_id: 'p' },
    }
    const file = writeLines(join(tempDir(), 'fork.jsonl'), jsonl(meta))
    const result = await scanCodexFile(file, tempDir(), {
      classifyFailure: () => 'k',
      limits: limits(),
    })
    expect(result).toHaveProperty('error')
    expect(discard).toHaveBeenCalled()
  })
})
