import { describe, expect, it, vi } from 'vitest'

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
  it('follows a root-owned symlink ancestor that resolves to a directory', () => {
    const directory = () => ({ isDirectory: () => true, isSymbolicLink: () => false })
    const effectiveUserId = process.geteuid ? process.geteuid() : 0
    mocks.lstat
      .mockReturnValueOnce(directory())
      .mockReturnValueOnce(directory())
      .mockReturnValueOnce({ isDirectory: () => false, isSymbolicLink: () => true, uid: 0 })
      .mockReturnValueOnce({
        isDirectory: () => true,
        isSymbolicLink: () => false,
        mode: 0o700,
        uid: effectiveUserId,
      })
    mocks.stat.mockReturnValueOnce({ isDirectory: () => true })

    expect(ensurePrivateDirectory('/a/sym/leaf', false)).toBe(true)
    expect(mocks.stat).toHaveBeenCalledOnce()
  })
})
