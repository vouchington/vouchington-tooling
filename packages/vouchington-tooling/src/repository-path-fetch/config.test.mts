import { constants, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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
        .mockResolvedValueOnce({ dev: 1, ino: 1, isFile: () => true, size: 2 })
        .mockResolvedValueOnce({ dev: 1, ino: 1, isFile: () => true, size: finalSize }),
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

    await expect(
      readRepositoryPathFetchConfig('/config.json', openFile, lstatFile),
    ).rejects.toThrow('config changed while reading')
    expect(file.close).toHaveBeenCalledOnce()
  })

  it('rejects symbolic links before opening them', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-fetch-config-'))
    try {
      const target = join(root, 'target.json')
      const path = join(root, 'config.json')
      writeFileSync(target, '{}')
      symlinkSync(target, path)
      await expect(readRepositoryPathFetchConfig(path)).rejects.toThrow(
        'must not be a symbolic link',
      )
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('rejects a path swap between lstat and open', async () => {
    const file = {
      close: vi.fn().mockResolvedValue(undefined),
      stat: vi.fn().mockResolvedValue({ dev: 1, ino: 2, isFile: () => true, size: 2 }),
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

    await expect(
      readRepositoryPathFetchConfig('/config.json', openFile, lstatFile),
    ).rejects.toThrow('config changed while opening')
    expect(file.close).toHaveBeenCalledOnce()
    expect(openFile).toHaveBeenCalledWith(
      '/config.json',
      process.platform === 'win32' ? constants.O_RDONLY : constants.O_RDONLY | constants.O_NOFOLLOW,
    )
  })

  it('rejects a path replacement after opening', async () => {
    const file = {
      close: vi.fn().mockResolvedValue(undefined),
      stat: vi.fn().mockResolvedValue({ dev: 1, ino: 1, isFile: () => true, size: 2 }),
    }
    const lstatFile = vi
      .fn()
      .mockResolvedValueOnce({ dev: 1, ino: 1, isFile: () => true, isSymbolicLink: () => false })
      .mockResolvedValueOnce({ dev: 1, ino: 2, isFile: () => true, isSymbolicLink: () => false })

    await expect(
      readRepositoryPathFetchConfig(
        '/config.json',
        vi.fn().mockResolvedValue(file) as unknown as typeof import('node:fs/promises').open,
        lstatFile,
      ),
    ).rejects.toThrow('config changed while opening')
    expect(file.close).toHaveBeenCalledOnce()
  })

  it('closes a non-regular opened descriptor', async () => {
    const file = {
      close: vi.fn().mockResolvedValue(undefined),
      stat: vi.fn().mockResolvedValue({ dev: 1, ino: 1, isFile: () => false, size: 2 }),
    }
    const lstatFile = vi.fn().mockResolvedValue({
      dev: 1,
      ino: 1,
      isFile: () => true,
      isSymbolicLink: () => false,
    })

    await expect(
      readRepositoryPathFetchConfig(
        '/config.json',
        vi.fn().mockResolvedValue(file) as unknown as typeof import('node:fs/promises').open,
        lstatFile,
      ),
    ).rejects.toThrow('config must be a regular file')
    expect(file.close).toHaveBeenCalledOnce()
  })

  it('does not request no-follow on Windows', async () => {
    const file = {
      close: vi.fn().mockResolvedValue(undefined),
      read: vi.fn(async (buffer: Buffer) => {
        Buffer.from('{}').copy(buffer)
        return { buffer, bytesRead: 2 }
      }),
      stat: vi.fn().mockResolvedValue({ dev: 1, ino: 1, isFile: () => true, size: 2 }),
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
      await expect(
        readRepositoryPathFetchConfig('/config.json', openFile, lstatFile),
      ).resolves.toBe('{}')
    } finally {
      Object.defineProperty(process, 'platform', descriptor)
    }
    expect(openFile).toHaveBeenCalledWith('/config.json', constants.O_RDONLY)
  })
})
