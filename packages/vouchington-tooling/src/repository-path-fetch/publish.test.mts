import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { publishBundle, recoverIncompletePublish } from './publish.mts'

describe('publishBundle', () => {
  it('recovers a partially published bundle when metadata publication fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-publish-'))
    try {
      const bundle = join(root, 'staged-bundle')
      const metadata = join(root, 'staged-metadata')
      const destination = join(root, 'bundle')
      const metadataDestination = join(root, 'metadata')
      mkdirSync(bundle)
      writeFileSync(join(bundle, 'file'), 'content')
      writeFileSync(metadata, '{}')
      mkdirSync(metadataDestination)
      await expect(
        publishBundle(bundle, destination, metadata, metadataDestination),
      ).rejects.toThrow()
      expect(existsSync(destination)).toBe(true)
      await recoverIncompletePublish(destination, metadataDestination)
      expect(existsSync(destination)).toBe(false)
      expect(existsSync(metadataDestination)).toBe(false)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('leaves a recoverable marker when the first publish boundary is interrupted', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-publish-'))
    try {
      const bundle = join(root, 'staged-bundle')
      const metadata = join(root, 'staged-metadata')
      const destination = join(root, 'bundle')
      const metadataDestination = join(root, 'metadata')
      mkdirSync(bundle)
      writeFileSync(metadata, '{}')
      await expect(
        publishBundle(bundle, destination, metadata, metadataDestination, async () => {
          throw new Error('interrupted')
        }),
      ).rejects.toThrow('interrupted')
      await recoverIncompletePublish(destination, metadataDestination)
      expect(existsSync(destination)).toBe(false)
      await publishBundle(bundle, destination, metadata, metadataDestination)
      expect(existsSync(destination)).toBe(true)
      expect(existsSync(metadataDestination)).toBe(true)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })
})
