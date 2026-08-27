import {
  constants,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { Readable } from 'node:stream'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { bundleEntries, comparePaths, digestEntries, sha256RegularFile } from './digest.mts'
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

  it('rejects a file path swapped after opening before hashing its descriptor', async () => {
    const file = {
      close: vi.fn().mockResolvedValue(undefined),
      createReadStream: vi.fn(() => Readable.from(['content'])),
      stat: async () => ({ dev: 1, ino: 1, isFile: () => true }),
    }
    const openFile = vi
      .fn()
      .mockResolvedValue(file) as unknown as typeof import('node:fs/promises').open
    const lstatFile = vi
      .fn()
      .mockResolvedValueOnce({ dev: 1, ino: 1, isFile: () => true, isSymbolicLink: () => false })
      .mockResolvedValueOnce({ dev: 1, ino: 2, isFile: () => true, isSymbolicLink: () => false })

    await expect(sha256RegularFile('/bundle/file', openFile, lstatFile)).rejects.toThrow(
      'bundle file changed while opening',
    )
    expect(file.createReadStream).not.toHaveBeenCalled()
    expect(file.close).toHaveBeenCalledOnce()
    expect(openFile).toHaveBeenCalledWith(
      '/bundle/file',
      process.platform === 'win32' ? constants.O_RDONLY : constants.O_RDONLY | constants.O_NOFOLLOW,
    )
  })

  it('rejects a symbolic link before opening it for hashing', async () => {
    const openFile = vi.fn() as unknown as typeof import('node:fs/promises').open
    const lstatFile = vi.fn().mockResolvedValue({
      dev: 1,
      ino: 1,
      isFile: () => false,
      isSymbolicLink: () => true,
    })

    await expect(sha256RegularFile('/bundle/link', openFile, lstatFile)).rejects.toThrow(
      'unsupported bundle entry: /bundle/link',
    )
    expect(openFile).not.toHaveBeenCalled()
  })

  it('does not request no-follow on Windows', async () => {
    const file = {
      close: vi.fn().mockResolvedValue(undefined),
      createReadStream: vi.fn(() => Readable.from(['content'])),
      stat: vi.fn().mockResolvedValue({ dev: 1, ino: 1, isFile: () => true }),
    }
    const openFile = vi
      .fn()
      .mockResolvedValue(file) as unknown as typeof import('node:fs/promises').open
    const lstatFile = vi.fn().mockResolvedValue({
      dev: 1,
      ino: 1,
      isFile: () => true,
      isSymbolicLink: () => false,
    })
    const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')
    if (descriptor === undefined) throw new Error('expected process.platform descriptor')
    Object.defineProperty(process, 'platform', { ...descriptor, value: 'win32' })
    try {
      await sha256RegularFile('/bundle/file', openFile, lstatFile)
    } finally {
      Object.defineProperty(process, 'platform', descriptor)
    }
    expect(openFile).toHaveBeenCalledWith('/bundle/file', constants.O_RDONLY)
  })
})
