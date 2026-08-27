import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { publishBundle, recoverIncompletePublish } from './publish.mts'

function markerContents(destination: string, metadata: string): string {
  return `${JSON.stringify({
    destination,
    metadata,
    owner: 2147483647,
    token: '00000000-0000-4000-8000-000000000000',
    version: 1,
  })}\n`
}

describe('publishBundle', () => {
  it('refuses preexisting outputs without deleting them', async () => {
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
      ).rejects.toThrow('output already exists')
      expect(existsSync(destination)).toBe(false)
      expect(existsSync(metadataDestination)).toBe(true)
      expect(existsSync(marker)).toBe(false)

      rmSync(metadataDestination, { recursive: true })
      await publishBundle(bundle, destination, metadata, metadataDestination)
      expect(existsSync(destination)).toBe(true)
      expect(existsSync(metadataDestination)).toBe(true)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('refuses a dangling symlink output without replacing it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-publish-'))
    try {
      const bundle = join(root, 'staged-bundle')
      const metadata = join(root, 'staged-metadata')
      const destination = join(root, 'bundle')
      mkdirSync(bundle)
      writeFileSync(metadata, '{}')
      symlinkSync(join(root, 'missing'), destination)
      await expect(
        publishBundle(bundle, destination, metadata, join(root, 'metadata')),
      ).rejects.toThrow('output already exists')
      expect(existsSync(destination)).toBe(false)
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

  it('preserves an output created concurrently after the bundle is published', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-publish-'))
    try {
      const bundle = join(root, 'staged-bundle')
      const metadata = join(root, 'staged-metadata')
      const destination = join(root, 'bundle')
      const metadataDestination = join(root, 'metadata')
      mkdirSync(bundle)
      writeFileSync(metadata, '{}')
      let moved = 0
      await expect(
        publishBundle(bundle, destination, metadata, metadataDestination, async (from, to) => {
          if (moved++ === 0) return rename(from, to)
          writeFileSync(metadataDestination, 'concurrent')
          throw new Error('metadata destination appeared')
        }),
      ).rejects.toThrow('metadata destination appeared')
      expect(existsSync(destination)).toBe(false)
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
      writeFileSync(marker, markerContents(destination, metadataDestination))

      await recoverIncompletePublish(destination, metadataDestination, () => false)

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
        markerContents(join(root, 'other'), metadataDestination),
      )
      await expect(
        recoverIncompletePublish(destination, metadataDestination, () => false),
      ).rejects.toThrow('marker does not match')
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it.each(['{', 'null', '[]', '1', 'x'.repeat(1025)])(
    'removes malformed recovery marker %j without deleting outputs',
    async (contents) => {
      const root = mkdtempSync(join(tmpdir(), 'repository-publish-'))
      try {
        const destination = join(root, 'bundle')
        const metadataDestination = join(root, 'metadata')
        const marker = join(root, '.bundle.fetch-incomplete')
        mkdirSync(destination)
        writeFileSync(metadataDestination, '{}')
        writeFileSync(marker, contents)
        await recoverIncompletePublish(destination, metadataDestination)
        expect(existsSync(destination)).toBe(true)
        expect(existsSync(metadataDestination)).toBe(true)
        expect(existsSync(marker)).toBe(false)
      } finally {
        rmSync(root, { force: true, recursive: true })
      }
    },
  )
})
