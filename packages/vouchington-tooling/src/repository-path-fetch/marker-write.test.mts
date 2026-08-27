import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { writeMarkerAtomic } from './marker-write.mts'

describe('writeMarkerAtomic', () => {
  it('publishes a fully written marker and removes its staging name', async () => {
    const write = vi.fn(async () => {})
    const createLink = vi.fn(async () => {})
    const removeStaged = vi.fn(async () => {})
    await writeMarkerAtomic('/marker', 'contents', write, createLink, removeStaged)
    expect(write).toHaveBeenCalledWith(expect.stringContaining('/marker.write-'), 'contents')
    expect(createLink).toHaveBeenCalledWith(expect.stringContaining('/marker.write-'), '/marker')
    expect(removeStaged).toHaveBeenCalledWith(expect.stringContaining('/marker.write-'))
  })

  it('removes staging when marker publication fails', async () => {
    const failure = new Error('link failed')
    const removeStaged = vi.fn(async () => {})
    await expect(
      writeMarkerAtomic(
        '/marker',
        'contents',
        async () => {},
        async () => {
          throw failure
        },
        removeStaged,
      ),
    ).rejects.toBe(failure)
    expect(removeStaged).toHaveBeenCalledOnce()
  })

  it('rolls back a linked marker when staging cleanup fails', async () => {
    const failure = new Error('cleanup failed')
    const removePublished = vi.fn(async () => {})
    await expect(
      writeMarkerAtomic(
        '/marker',
        'contents',
        async () => {},
        async () => {},
        async () => {
          throw failure
        },
        removePublished,
      ),
    ).rejects.toBe(failure)
    expect(removePublished).toHaveBeenCalledWith('/marker')
  })

  it('removes the real linked marker when staging cleanup fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-marker-write-'))
    try {
      const marker = join(root, 'marker')
      await expect(
        writeMarkerAtomic(marker, 'contents', undefined, undefined, async () => {
          throw new Error('cleanup failed')
        }),
      ).rejects.toThrow('cleanup failed')
      expect(existsSync(marker)).toBe(false)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })
})
