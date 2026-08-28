import { afterEach, describe, expect, it, vi } from 'vitest'

import { ensurePrivateDirectory } from './directory.mts'

const mocks = vi.hoisted(() => ({
  lstat: vi.fn(),
  stat: vi.fn(),
}))

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {
    ...actual,
    lstatSync: mocks.lstat,
    statSync: mocks.stat,
  }
})

describe('ensurePrivateDirectory symlink ancestors', () => {
  afterEach(() => vi.clearAllMocks())

  it('fails closed without POSIX ownership checks', () => {
    vi.spyOn(process, 'geteuid').mockReturnValueOnce(undefined as never)
    expect(() => ensurePrivateDirectory('/private/audit', false)).toThrow(
      /POSIX directory permissions/,
    )
  })

  it('follows a root-owned symlink ancestor that resolves to a directory', () => {
    const effectiveUserId = process.geteuid ? process.geteuid() : 0
    const directory = (uid: number, mode: number) => ({
      isDirectory: () => true,
      isSymbolicLink: () => false,
      mode,
      uid,
    })
    mocks.lstat
      .mockReturnValueOnce(directory(0, 0o755))
      .mockReturnValueOnce(directory(effectiveUserId, 0o755))
      .mockReturnValueOnce({ isDirectory: () => false, isSymbolicLink: () => true, uid: 0 })
      .mockReturnValueOnce(directory(effectiveUserId, 0o700))
    mocks.stat.mockReturnValueOnce(directory(0, 0o755))

    expect(ensurePrivateDirectory('/a/sym/leaf', false)).toBe(true)
    expect(mocks.stat).toHaveBeenCalledOnce()
  })

  it('rejects an untrusted writable ancestor', () => {
    const effectiveUserId = process.geteuid ? process.geteuid() : 0
    const directory = (uid: number, mode: number) => ({
      isDirectory: () => true,
      isSymbolicLink: () => false,
      mode,
      uid,
    })
    mocks.lstat
      .mockReturnValueOnce(directory(0, 0o755))
      .mockReturnValueOnce(directory(effectiveUserId, 0o777))
    expect(() => ensurePrivateDirectory('/unsafe/leaf', false)).toThrow(/private directory/)
  })

  it('normalizes a dangling root-owned symlink ancestor error', () => {
    mocks.lstat
      .mockReturnValueOnce({
        isDirectory: () => true,
        isSymbolicLink: () => false,
        mode: 0o755,
        uid: 0,
      })
      .mockReturnValueOnce({ isDirectory: () => false, isSymbolicLink: () => true, uid: 0 })
    mocks.stat.mockImplementationOnce(() => {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    })

    expect(() => ensurePrivateDirectory('/dangling/leaf', false)).toThrow(/private directory/)
  })
})
