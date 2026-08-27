import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { recoverIncompletePublish } from './publish.mts'

describe('publish recovery malformed marker directories', () => {
  it('preserves an empty directory malformed marker without deleting outputs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-publish-'))
    try {
      const destination = join(root, 'bundle')
      const metadataDestination = join(root, 'metadata')
      const marker = join(root, '.bundle.fetch-incomplete')
      mkdirSync(destination)
      writeFileSync(metadataDestination, '{}')
      mkdirSync(marker)
      await expect(recoverIncompletePublish(destination, metadataDestination)).rejects.toThrow(
        'incomplete publish marker has unsupported type',
      )
      expect(existsSync(destination)).toBe(true)
      expect(existsSync(metadataDestination)).toBe(true)
      expect(existsSync(marker)).toBe(true)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('preserves a non-empty directory malformed marker without deleting outputs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-publish-'))
    try {
      const destination = join(root, 'bundle')
      const metadataDestination = join(root, 'metadata')
      const marker = join(root, '.bundle.fetch-incomplete')
      mkdirSync(destination)
      writeFileSync(metadataDestination, '{}')
      mkdirSync(marker)
      writeFileSync(join(marker, 'preserve'), 'concurrent')
      await expect(recoverIncompletePublish(destination, metadataDestination)).rejects.toThrow(
        'marker has unsupported type',
      )
      expect(readFileSync(join(marker, 'preserve'), 'utf8')).toBe('concurrent')
      expect(existsSync(destination)).toBe(true)
      expect(existsSync(metadataDestination)).toBe(true)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it.skipIf(process.platform === 'win32')('rejects an unsupported marker type', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-publish-'))
    const server = createServer()
    try {
      const destination = join(root, 'bundle')
      const metadataDestination = join(root, 'metadata')
      const marker = join(root, '.bundle.fetch-incomplete')
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(marker, resolve)
      })
      await expect(recoverIncompletePublish(destination, metadataDestination)).rejects.toThrow(
        'marker has unsupported type',
      )
      expect(existsSync(marker)).toBe(true)
    } finally {
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
      rmSync(root, { force: true, recursive: true })
    }
  })
})
