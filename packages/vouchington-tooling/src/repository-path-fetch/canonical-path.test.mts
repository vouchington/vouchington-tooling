import { describe, expect, it, vi } from 'vitest'
import { canonicalizeNearestExistingPath, isCaseInsensitivePath } from './canonical-path.mts'

describe('canonicalizeNearestExistingPath', () => {
  it('reconstructs missing leaves below the nearest existing ancestor', () => {
    const resolvePath = vi.fn((path: string) => {
      if (path === '/real') return '/canonical'
      throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    })
    expect(
      canonicalizeNearestExistingPath('/real/nested/file', resolvePath, undefined, () => false),
    ).toBe('/canonical/nested/file')
  })

  it('propagates errors other than a missing path', () => {
    const denied = Object.assign(new Error('denied'), { code: 'EACCES' })
    expect(() =>
      canonicalizeNearestExistingPath('/private/file', () => {
        throw denied
      }),
    ).toThrow(denied)
  })

  it('propagates a missing filesystem root', () => {
    const missing = Object.assign(new Error('missing'), { code: 'ENOENT' })
    expect(() =>
      canonicalizeNearestExistingPath('/', () => {
        throw missing
      }),
    ).toThrow(missing)
  })

  it('folds missing suffixes on a case-insensitive volume', () => {
    const resolvePath = (path: string) => {
      if (path === '/existing') return '/Existing'
      throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    }
    expect(
      canonicalizeNearestExistingPath('/existing/CaseDir/File', resolvePath, undefined, () => true),
    ).toBe('/Existing/casedir/file')
  })
})

describe('isCaseInsensitivePath', () => {
  it('treats Windows paths as case-insensitive without probing', () => {
    const statPath = vi.fn()
    expect(isCaseInsensitivePath('C:\\Path', statPath, 'win32')).toBe(true)
    expect(statPath).not.toHaveBeenCalled()
  })

  it.each([
    [{ dev: 1n, ino: 2n }, true],
    [{ dev: 1n, ino: 3n }, false],
  ])('compares the first case-toggled alias identity %#', (toggledIdentity, expected) => {
    const statPath = vi
      .fn()
      .mockReturnValueOnce({ dev: 1n, ino: 2n })
      .mockReturnValueOnce(toggledIdentity)
    expect(isCaseInsensitivePath('/tmp/parent', statPath, 'linux')).toBe(expected)
    expect(statPath).toHaveBeenCalledTimes(2)
  })

  it('treats a missing case-toggled alias as case-sensitive', () => {
    const statPath = vi
      .fn()
      .mockReturnValueOnce({ dev: 1n, ino: 2n })
      .mockImplementationOnce(() => {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      })
    expect(isCaseInsensitivePath('/tmp/parent', statPath, 'linux')).toBe(false)
  })

  it('does not probe a path without alphabetic characters', () => {
    const statPath = vi.fn().mockReturnValue({ dev: 1n, ino: 2n })
    expect(isCaseInsensitivePath('/123/456', statPath, 'linux')).toBe(false)
    expect(statPath).toHaveBeenCalledTimes(1)
  })
})
