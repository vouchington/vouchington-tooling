import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { publishBundle, recoverIncompletePublish } from './publish.mts'

describe('publishBundle', () => {
  it('immediately cleans published outputs when metadata publication fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-publish-'))
    try {
      const bundle = join(root, 'staged-bundle')
      const metadata = join(root, 'staged-metadata')
      const destination = join(root, 'bundle')
      const metadataDestination = join(root, 'metadata')
      const marker = join(root, '.bundle.fetch-incomplete')
      mkdirSync(bundle)
      writeFileSync(join(bundle, 'file'), 'content')
      writeFileSync(metadata, '{}')
      mkdirSync(metadataDestination)
      await expect(
        publishBundle(bundle, destination, metadata, metadataDestination),
      ).rejects.toThrow()
      expect(existsSync(destination)).toBe(false)
      expect(existsSync(metadataDestination)).toBe(false)
      expect(existsSync(marker)).toBe(false)

      mkdirSync(bundle)
      writeFileSync(join(bundle, 'file'), 'content')
      await publishBundle(bundle, destination, metadata, metadataDestination)
      expect(existsSync(destination)).toBe(true)
      expect(existsSync(metadataDestination)).toBe(true)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('immediately cleans outputs when the first publish boundary fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-publish-'))
    try {
      const bundle = join(root, 'staged-bundle')
      const metadata = join(root, 'staged-metadata')
      const destination = join(root, 'bundle')
      const metadataDestination = join(root, 'metadata')
      const marker = join(root, '.bundle.fetch-incomplete')
      mkdirSync(bundle)
      writeFileSync(metadata, '{}')
      await expect(
        publishBundle(bundle, destination, metadata, metadataDestination, async () => {
          throw new Error('interrupted')
        }),
      ).rejects.toThrow('interrupted')
      expect(existsSync(destination)).toBe(false)
      expect(existsSync(metadataDestination)).toBe(false)
      expect(existsSync(marker)).toBe(false)
      await publishBundle(bundle, destination, metadata, metadataDestination)
      expect(existsSync(destination)).toBe(true)
      expect(existsSync(metadataDestination)).toBe(true)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('recovers a marker left by process termination between publish boundaries', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-publish-'))
    try {
      const destination = join(root, 'bundle')
      const metadataDestination = join(root, 'metadata')
      const marker = join(root, '.bundle.fetch-incomplete')
      mkdirSync(destination)
      writeFileSync(metadataDestination, '{}')
      writeFileSync(marker, `${JSON.stringify({ destination, metadata: metadataDestination })}\n`)

      await recoverIncompletePublish(destination, metadataDestination)

      expect(existsSync(destination)).toBe(false)
      expect(existsSync(metadataDestination)).toBe(false)
      expect(existsSync(marker)).toBe(false)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('rejects a recovery marker bound to different outputs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-publish-'))
    try {
      const destination = join(root, 'bundle')
      const metadataDestination = join(root, 'metadata')
      writeFileSync(
        join(root, '.bundle.fetch-incomplete'),
        `${JSON.stringify({ destination: join(root, 'other'), metadata: metadataDestination })}\n`,
      )
      await expect(recoverIncompletePublish(destination, metadataDestination)).rejects.toThrow(
        'marker does not match',
      )
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })
})
