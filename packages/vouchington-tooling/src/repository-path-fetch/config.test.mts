import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { MAX_CONFIG_BYTES, readRepositoryPathFetchConfig } from './config.mts'

describe('readRepositoryPathFetchConfig', () => {
  it('reads a bounded regular file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-fetch-config-'))
    try {
      const path = join(root, 'config.json')
      writeFileSync(path, '{}')
      await expect(readRepositoryPathFetchConfig(path)).resolves.toBe('{}')
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it.each(['directory', 'oversized'])('rejects a %s config', async (kind) => {
    const root = mkdtempSync(join(tmpdir(), 'repository-fetch-config-'))
    try {
      const path = join(root, 'config.json')
      if (kind === 'directory') mkdirSync(path)
      else writeFileSync(path, Buffer.alloc(MAX_CONFIG_BYTES + 1))
      await expect(readRepositoryPathFetchConfig(path)).rejects.toThrow(
        kind === 'directory' ? 'regular file' : 'size limit',
      )
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it.each([
    { bytesRead: 0, finalSize: 2, name: 'shrinks while being read' },
    { bytesRead: 2, finalSize: 3, name: 'grows while being read' },
  ])('rejects a config that $name', async ({ bytesRead, finalSize }) => {
    const bufferContents = Buffer.from('{}')
    const file = {
      close: vi.fn().mockResolvedValue(undefined),
      read: vi.fn().mockImplementation(async (buffer: Buffer) => {
        bufferContents.copy(buffer)
        return { buffer, bytesRead }
      }),
      stat: vi
        .fn()
        .mockResolvedValueOnce({ isFile: () => true, size: 2 })
        .mockResolvedValueOnce({ isFile: () => true, size: finalSize }),
    }
    const openFile = vi
      .fn()
      .mockResolvedValue(file) as unknown as typeof import('node:fs/promises').open

    await expect(readRepositoryPathFetchConfig('/config.json', openFile)).rejects.toThrow(
      'config changed while reading',
    )
    expect(file.close).toHaveBeenCalledOnce()
  })
})
