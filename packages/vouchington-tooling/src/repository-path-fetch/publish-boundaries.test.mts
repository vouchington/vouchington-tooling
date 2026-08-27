import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { outputIdentity } from './output-identity.mts'
import { outputExists, publishBundle } from './publish.mts'

describe('publishBundle input boundaries', () => {
  it('propagates filesystem errors while checking output existence', () => {
    const failure = Object.assign(new Error('permission denied'), { code: 'EACCES' })
    expect(() =>
      outputExists('/unreadable', () => {
        throw failure
      }),
    ).toThrow(failure)
  })

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

  it('rejects a non-file staged output', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-publish-'))
    try {
      const bundle = join(root, 'staged-bundle')
      const metadata = join(root, 'staged-metadata')
      symlinkSync(join(root, 'missing'), bundle)
      writeFileSync(metadata, '{}')
      await expect(
        publishBundle(bundle, join(root, 'bundle'), metadata, join(root, 'metadata')),
      ).rejects.toThrow('unsupported staged output')
      expect(existsSync(join(root, '.bundle.fetch-incomplete'))).toBe(false)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('does not adopt a marker replaced after exclusive creation', async () => {
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
      await expect(
        publishBundle(
          bundle,
          destination,
          metadata,
          metadataDestination,
          undefined,
          async (path, contents) => {
            writeFileSync(path, contents)
            const identity = await outputIdentity(path)
            rmSync(path)
            writeFileSync(path, 'foreign')
            return identity
          },
        ),
      ).rejects.toThrow('incomplete publish marker changed after creation')
      expect(existsSync(destination)).toBe(false)
      expect(existsSync(metadataDestination)).toBe(false)
      expect(existsSync(marker)).toBe(true)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })
})
