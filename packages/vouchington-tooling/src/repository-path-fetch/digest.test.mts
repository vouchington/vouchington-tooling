import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bundleEntries, comparePaths, digestEntries } from './digest.mts'
import { bundleDigest } from './index.mts'

describe('bundleDigest', () => {
  it('streams file contents independently of traversal order', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-path-fetch-'))
    try {
      mkdirSync(join(root, 'nested'))
      writeFileSync(join(root, 'nested/a.txt'), 'a')
      writeFileSync(join(root, 'b.txt'), 'b')
      const modes = new Map([
        ['b.txt', '0644'],
        ['nested/a.txt', '0644'],
      ])
      const initial = await bundleDigest(root, modes)
      await expect(bundleDigest(root, modes)).resolves.toBe(initial)
      writeFileSync(join(root, 'b.txt'), 'changed')
      await expect(bundleDigest(root, modes)).resolves.not.toBe(initial)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('orders flattened paths with the canonical byte comparator', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-path-fetch-'))
    try {
      mkdirSync(join(root, 'a'))
      writeFileSync(join(root, 'a/file'), 'nested')
      writeFileSync(join(root, 'a.txt'), 'sibling')
      await expect(bundleEntries(root)).resolves.toEqual([
        expect.objectContaining({ destination: 'a.txt' }),
        expect.objectContaining({ destination: 'a/file' }),
      ])
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('normalizes standalone file modes independently of the host filesystem', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-path-fetch-'))
    try {
      writeFileSync(join(root, 'executable'), 'content')
      chmodSync(join(root, 'executable'), 0o755)
      await expect(bundleEntries(root)).resolves.toEqual([
        expect.objectContaining({ destination: 'executable', mode: '0644' }),
      ])
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('rejects Git mode ownership that does not exactly cover the bundle', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-path-fetch-'))
    try {
      writeFileSync(join(root, 'file'), 'content')
      await expect(
        bundleEntries(
          root,
          new Map([
            ['file', '0644'],
            ['missing', '0755'],
          ]),
        ),
      ).rejects.toThrow('bundle files do not match validated Git tree')
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('rejects symbolic links', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-path-fetch-'))
    try {
      writeFileSync(join(root, 'target'), 'content')
      symlinkSync('target', join(root, 'link'))
      await expect(
        bundleDigest(
          root,
          new Map([
            ['link', '0644'],
            ['target', '0644'],
          ]),
        ),
      ).rejects.toThrow('symbolic link')
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('makes ordering irrelevant and detects metadata entry tampering', () => {
    const entries = [
      { destination: 'b', mode: '0644', sha256: 'b'.repeat(64) },
      { destination: 'a', mode: '0644', sha256: 'a'.repeat(64) },
    ]
    expect(digestEntries(entries)).toBe(digestEntries([...entries].reverse()))
    expect(digestEntries(entries)).not.toBe(
      digestEntries([{ ...entries[0]!, sha256: 'c'.repeat(64) }, entries[1]!]),
    )
  })

  it('orders non-ASCII paths by UTF-8 bytes rather than locale', () => {
    expect(
      [{ destination: 'z' }, { destination: 'ä' }]
        .sort(comparePaths)
        .map((entry) => entry.destination),
    ).toEqual(['z', 'ä'])
  })
})
