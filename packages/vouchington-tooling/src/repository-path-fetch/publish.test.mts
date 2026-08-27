import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { publishBundle, recoverIncompletePublish } from './publish.mts'

function markerContents(destination: string, metadata: string): string {
  const identity = (path: string, fallbackType: 'directory' | 'file') => {
    try {
      const stat = lstatSync(path, { bigint: true })
      return {
        dev: String(stat.dev),
        ino: String(stat.ino),
        type: stat.isDirectory() ? ('directory' as const) : ('file' as const),
      }
    } catch {
      return { dev: '0', ino: '0', type: fallbackType }
    }
  }
  return `${JSON.stringify({
    bundleIdentity: identity(destination, 'directory'),
    createdAt: Date.now(),
    destination,
    metadata,
    metadataIdentity: identity(metadata, 'file'),
    owner: 2147483647,
    token: '00000000-0000-4000-8000-000000000000',
    version: 1,
  })}\n`
}

describe('publishBundle', () => {
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
          if (moved++ === 0) {
            await rename(from, to)
            writeFileSync(metadataDestination, 'concurrent')
            return
          }
          throw new Error('unexpected metadata move')
        }),
      ).rejects.toThrow('output already exists')
      expect(existsSync(destination)).toBe(false)
      expect(existsSync(metadataDestination)).toBe(true)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('cleans both owned outputs when marker removal fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-publish-'))
    try {
      const bundle = join(root, 'staged-bundle')
      const metadata = join(root, 'staged-metadata')
      const destination = join(root, 'bundle')
      const metadataDestination = join(root, 'metadata')
      mkdirSync(bundle)
      writeFileSync(metadata, '{}')
      await expect(
        publishBundle(
          bundle,
          destination,
          metadata,
          metadataDestination,
          rename,
          async (path, contents) => writeFileSync(path, contents),
          async () => {
            throw new Error('marker removal failed')
          },
        ),
      ).rejects.toThrow('marker removal failed')
      expect(existsSync(destination)).toBe(false)
      expect(existsSync(metadataDestination)).toBe(false)
      expect(existsSync(join(root, '.bundle.fetch-incomplete'))).toBe(true)
      await recoverIncompletePublish(destination, metadataDestination, () => false)
      expect(existsSync(join(root, '.bundle.fetch-incomplete'))).toBe(false)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('preserves a replacement created after rollback claims the owned output', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-publish-'))
    try {
      const bundle = join(root, 'staged-bundle')
      const metadata = join(root, 'staged-metadata')
      const destination = join(root, 'bundle')
      const metadataDestination = join(root, 'metadata')
      mkdirSync(bundle)
      writeFileSync(join(bundle, 'owned'), 'owned')
      writeFileSync(metadata, '{}')
      await expect(
        publishBundle(
          bundle,
          destination,
          metadata,
          metadataDestination,
          rename,
          async (path, contents) => writeFileSync(path, contents),
          async () => {
            throw new Error('marker removal failed')
          },
          async (claimed) => {
            if (claimed.includes('.bundle.remove-')) {
              mkdirSync(destination)
              writeFileSync(join(destination, 'replacement'), 'keep')
            }
            rmSync(claimed, { force: true, recursive: true })
          },
        ),
      ).rejects.toThrow('marker removal failed')
      expect(readFileSync(join(destination, 'replacement'), 'utf8')).toBe('keep')
      expect(existsSync(metadataDestination)).toBe(false)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it.each(['destination', 'metadata'])(
    'retains the marker when %s rollback fails',
    async (failed) => {
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
          publishBundle(
            bundle,
            destination,
            metadata,
            metadataDestination,
            rename,
            async (path, contents) => writeFileSync(path, contents),
            async () => {
              throw new Error('marker removal failed')
            },
            async (path) => {
              if (
                (failed === 'destination' && path.includes('.bundle.remove-')) ||
                (failed === 'metadata' && path.includes('.metadata.remove-'))
              ) {
                throw new Error(`${failed} rollback failed`)
              }
              rmSync(path, { force: true, recursive: true })
            },
          ),
        ).rejects.toThrow(`${failed} rollback failed`)
        expect(existsSync(marker)).toBe(true)
        expect(existsSync(destination)).toBe(failed === 'destination')
        expect(existsSync(metadataDestination)).toBe(true)

        await recoverIncompletePublish(destination, metadataDestination, () => false)
        expect(existsSync(destination)).toBe(false)
        expect(existsSync(metadataDestination)).toBe(false)
        expect(existsSync(marker)).toBe(false)
      } finally {
        rmSync(root, { force: true, recursive: true })
      }
    },
  )

  it('rejects an output created after acquiring the publication marker', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-publish-'))
    try {
      const bundle = join(root, 'staged-bundle')
      const metadata = join(root, 'staged-metadata')
      const destination = join(root, 'bundle')
      const metadataDestination = join(root, 'metadata')
      mkdirSync(bundle)
      writeFileSync(metadata, '{}')
      await expect(
        publishBundle(
          bundle,
          destination,
          metadata,
          metadataDestination,
          undefined,
          async (path, contents) => {
            writeFileSync(path, contents)
            mkdirSync(destination)
          },
        ),
      ).rejects.toThrow('output already exists')
      expect(existsSync(destination)).toBe(true)
      expect(existsSync(metadataDestination)).toBe(false)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('reports an exclusive marker collision without deleting the winner marker', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-publish-'))
    try {
      const bundle = join(root, 'staged-bundle')
      const metadata = join(root, 'staged-metadata')
      const destination = join(root, 'bundle')
      const metadataDestination = join(root, 'metadata')
      const marker = join(root, '.bundle.fetch-incomplete')
      mkdirSync(bundle)
      writeFileSync(metadata, '{}')
      writeFileSync(marker, 'winner')
      await expect(
        publishBundle(bundle, destination, metadata, metadataDestination),
      ).rejects.toThrow('output already exists')
      expect(readFileSync(marker, 'utf8')).toBe('winner')
      expect(existsSync(destination)).toBe(false)
      expect(existsSync(metadataDestination)).toBe(false)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('propagates unexpected marker creation failures', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-publish-'))
    try {
      const failure = Object.assign(new Error('permission denied'), { code: 'EACCES' })
      mkdirSync(join(root, 'staged-bundle'))
      writeFileSync(join(root, 'staged-metadata'), '{}')
      await expect(
        publishBundle(
          join(root, 'staged-bundle'),
          join(root, 'bundle'),
          join(root, 'staged-metadata'),
          join(root, 'metadata'),
          rename,
          async () => {
            throw failure
          },
        ),
      ).rejects.toBe(failure)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('rejects output paths that cannot fit in the bounded recovery marker', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-publish-'))
    try {
      const bundle = join(root, 'staged-bundle')
      const metadata = join(root, 'staged-metadata')
      const destination = `${root}/${'segment/'.repeat(600)}bundle`
      mkdirSync(bundle)
      writeFileSync(metadata, '{}')
      await expect(
        publishBundle(bundle, destination, metadata, join(root, 'metadata')),
      ).rejects.toThrow('output paths are too long for recovery metadata')
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

  it('retains a stale marker rather than deleting a replacement output', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-publish-'))
    try {
      const destination = join(root, 'bundle')
      const metadataDestination = join(root, 'metadata')
      const marker = join(root, '.bundle.fetch-incomplete')
      mkdirSync(destination)
      writeFileSync(metadataDestination, '{}')
      writeFileSync(marker, markerContents(destination, metadataDestination))
      renameSync(destination, join(root, 'original-bundle'))
      mkdirSync(destination)
      writeFileSync(join(destination, 'replacement'), 'keep')

      await expect(
        recoverIncompletePublish(destination, metadataDestination, () => false),
      ).rejects.toThrow('published output ownership changed')

      expect(readFileSync(join(destination, 'replacement'), 'utf8')).toBe('keep')
      expect(existsSync(metadataDestination)).toBe(true)
      expect(existsSync(marker)).toBe(true)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('retains a stale marker when output identity cannot be inspected', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-publish-'))
    try {
      const destination = join(root, 'bundle')
      const metadataDestination = join(root, 'blocked', 'metadata')
      const marker = join(root, '.bundle.fetch-incomplete')
      mkdirSync(destination)
      writeFileSync(marker, markerContents(destination, metadataDestination))
      writeFileSync(join(root, 'blocked'), 'not a directory')

      await expect(
        recoverIncompletePublish(destination, metadataDestination, () => false),
      ).rejects.toThrow()
      expect(existsSync(marker)).toBe(true)
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

  it.each([
    ['EPERM', 'repository bundle publication is in progress'],
    ['EACCES', 'owner lookup failed'],
  ])('handles process-liveness error %s', async (code, message) => {
    const root = mkdtempSync(join(tmpdir(), 'repository-publish-'))
    const destination = join(root, 'bundle')
    const metadataDestination = join(root, 'metadata')
    try {
      writeFileSync(
        join(root, '.bundle.fetch-incomplete'),
        markerContents(destination, metadataDestination),
      )
      const failure = Object.assign(new Error('owner lookup failed'), { code })
      vi.spyOn(process, 'kill').mockImplementation(() => {
        throw failure
      })
      await expect(recoverIncompletePublish(destination, metadataDestination)).rejects.toThrow(
        message,
      )
    } finally {
      vi.restoreAllMocks()
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('recovers an expired marker even when its PID has been reused', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-publish-'))
    const destination = join(root, 'bundle')
    const metadataDestination = join(root, 'metadata')
    const marker = join(root, '.bundle.fetch-incomplete')
    try {
      mkdirSync(destination)
      writeFileSync(metadataDestination, '{}')
      writeFileSync(marker, markerContents(destination, metadataDestination))
      await recoverIncompletePublish(
        destination,
        metadataDestination,
        () => true,
        () => Date.now() + 7 * 60 * 60 * 1000,
      )
      expect(existsSync(destination)).toBe(false)
      expect(existsSync(metadataDestination)).toBe(false)
      expect(existsSync(marker)).toBe(false)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it.each([
    '{',
    'null',
    '[]',
    '1',
    JSON.stringify({
      bundleIdentity: null,
      createdAt: Date.now(),
      destination: '/bundle',
      metadata: '/metadata',
      metadataIdentity: { dev: '1', ino: '1', type: 'file' },
      owner: 1,
      token: '00000000-0000-4000-8000-000000000000',
      version: 1,
    }),
    'x'.repeat(4097),
  ])('removes malformed recovery marker %j without deleting outputs', async (contents) => {
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
  })

  it('removes a malformed marker symlink without deleting its target or outputs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-publish-'))
    try {
      const destination = join(root, 'bundle')
      const metadataDestination = join(root, 'metadata')
      const marker = join(root, '.bundle.fetch-incomplete')
      const target = join(root, 'marker-target')
      mkdirSync(destination)
      writeFileSync(metadataDestination, '{}')
      writeFileSync(target, 'preserve')
      symlinkSync(target, marker)
      await recoverIncompletePublish(destination, metadataDestination)
      expect(readFileSync(target, 'utf8')).toBe('preserve')
      expect(existsSync(marker)).toBe(false)
      expect(existsSync(destination)).toBe(true)
      expect(existsSync(metadataDestination)).toBe(true)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })
})
