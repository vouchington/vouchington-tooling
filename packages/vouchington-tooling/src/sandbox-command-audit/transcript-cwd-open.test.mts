import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { tempDir, writeLines } from './fixtures.test-helpers.mts'
import { readTranscriptCwd } from './transcript-cwd.mts'

vi.mock('../retrospective-transcript/index.mts', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  openTranscriptLines: async () => ({ error: 'cannot reopen' }),
}))

describe('readTranscriptCwd', () => {
  it('rejects when the streamed rescan of a large file cannot open it', async () => {
    const filler = JSON.stringify({ pad: 'p'.repeat(70 * 1024) })
    const path = writeLines(join(tempDir(), 'big.jsonl'), [filler, '{"cwd":"/late"}'])
    await expect(readTranscriptCwd(path)).rejects.toThrow('cannot reopen')
  })
})
