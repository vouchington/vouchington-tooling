import { describe, expect, it, vi } from 'vitest'
import {
  canonicalizeNearestExistingPath,
  isCaseInsensitivePath,
  probeDirectoryCaseSensitivity,
} from './canonical-path.mts'

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
    const probeDirectory = vi.fn()
    expect(isCaseInsensitivePath('C:\\Path', probeDirectory, 'win32')).toBe(true)
    expect(probeDirectory).not.toHaveBeenCalled()
  })

  it('uses a probe inside the hosting directory', () => {
    const probeDirectory = vi.fn(() => true)
    expect(isCaseInsensitivePath('/mounted-volume', probeDirectory, 'linux')).toBe(true)
    expect(probeDirectory).toHaveBeenCalledWith('/mounted-volume')
  })

  it('probes the parent when the existing path is a file', () => {
    const notDirectory = Object.assign(new Error('not a directory'), { code: 'ENOTDIR' })
    const probeDirectory = vi
      .fn()
      .mockImplementationOnce(() => {
        throw notDirectory
      })
      .mockReturnValueOnce(false)
    expect(isCaseInsensitivePath('/mounted-volume/output.json', probeDirectory, 'linux')).toBe(
      false,
    )
    expect(probeDirectory.mock.calls).toEqual([
      ['/mounted-volume/output.json'],
      ['/mounted-volume'],
    ])
  })

  it('does not retry a directory probe that fails for another reason', () => {
    const failure = Object.assign(new Error('denied'), { code: 'EACCES' })
    const probeDirectory = vi.fn(() => {
      throw failure
    })
    expect(() => isCaseInsensitivePath('/mounted-volume', probeDirectory, 'linux')).toThrow(failure)
    expect(probeDirectory).toHaveBeenCalledOnce()
  })
})

describe('probeDirectoryCaseSensitivity', () => {
  it.each([
    [{ dev: 1n, ino: 2n }, true],
    [{ dev: 1n, ino: 3n }, false],
  ])('compares a probe alias inside the directory %#', (aliasIdentity, expected) => {
    const createProbe = vi.fn()
    const identity = vi
      .fn()
      .mockReturnValueOnce({ dev: 1n, ino: 2n })
      .mockReturnValueOnce(aliasIdentity)
      .mockReturnValueOnce({ dev: 1n, ino: 2n })
    const removeProbe = vi.fn()
    expect(
      probeDirectoryCaseSensitivity('/mount', createProbe, identity, removeProbe, '.v-probe'),
    ).toBe(expected)
    expect(createProbe).toHaveBeenCalledWith('/mount/.v-probe')
    expect(removeProbe).toHaveBeenCalledWith('/mount/.v-probe')
  })

  it('treats a missing case alias as case-sensitive and removes the probe', () => {
    const missing = Object.assign(new Error('missing'), { code: 'ENOENT' })
    const identity = vi
      .fn()
      .mockReturnValueOnce({ dev: 1n, ino: 2n })
      .mockImplementationOnce(() => {
        throw missing
      })
      .mockReturnValueOnce({ dev: 1n, ino: 2n })
    const removeProbe = vi.fn()
    expect(
      probeDirectoryCaseSensitivity('/mount', vi.fn(), identity, removeProbe, '.v-probe'),
    ).toBe(false)
    expect(removeProbe).toHaveBeenCalledOnce()
  })

  it('propagates probe failures and still removes the probe', () => {
    const failure = Object.assign(new Error('denied'), { code: 'EACCES' })
    const identity = vi
      .fn()
      .mockReturnValueOnce({ dev: 1n, ino: 2n })
      .mockImplementationOnce(() => {
        throw failure
      })
      .mockReturnValueOnce({ dev: 1n, ino: 2n })
    const removeProbe = vi.fn()
    expect(() =>
      probeDirectoryCaseSensitivity('/mount', vi.fn(), identity, removeProbe, '.v-probe'),
    ).toThrow(failure)
    expect(removeProbe).toHaveBeenCalledOnce()
  })

  it('leaves a replacement probe untouched and fails closed', () => {
    const identity = vi
      .fn()
      .mockReturnValueOnce({ dev: 1n, ino: 2n })
      .mockReturnValueOnce({ dev: 1n, ino: 2n })
      .mockReturnValueOnce({ dev: 1n, ino: 3n })
    const removeProbe = vi.fn()
    expect(() =>
      probeDirectoryCaseSensitivity('/mount', vi.fn(), identity, removeProbe, '.v-probe'),
    ).toThrow('case probe changed before cleanup')
    expect(removeProbe).not.toHaveBeenCalled()
  })

  it('does not unlink a probe whose initial identity cannot be established', () => {
    const failure = new Error('unreadable probe')
    const identity = vi.fn(() => {
      throw failure
    })
    const removeProbe = vi.fn()
    expect(() =>
      probeDirectoryCaseSensitivity('/mount', vi.fn(), identity, removeProbe, '.v-probe'),
    ).toThrow('case probe identity unavailable during cleanup')
    expect(removeProbe).not.toHaveBeenCalled()
  })
})
