import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  assertOwnedDirectory,
  ensurePrivateLicenseAuditStore,
  licenseAuditStoreDirectory,
  pnpmCacheDirectory,
} from './audit-store.mts'

function tempDirectory(): string {
  return mkdtempSync(join(tmpdir(), 'license-audit-store-'))
}

describe('license audit store', () => {
  it('places the store under the platform pnpm cache', () => {
    expect(pnpmCacheDirectory({ XDG_CACHE_HOME: '/xdg' }, '/home', 'darwin')).toBe(
      join('/home', 'Library', 'Caches', 'pnpm'),
    )
    expect(pnpmCacheDirectory({ LOCALAPPDATA: 'C:\\Local' }, '/home', 'win32')).toBe(
      join('C:\\Local', 'pnpm-cache'),
    )
    expect(pnpmCacheDirectory({}, '/home', 'win32')).toBe(
      join('/home', 'AppData', 'Local', 'pnpm-cache'),
    )
    expect(pnpmCacheDirectory({ XDG_CACHE_HOME: '/xdg' }, '/home', 'linux')).toBe(
      join('/xdg', 'pnpm'),
    )
    expect(pnpmCacheDirectory({}, '/home', 'linux')).toBe(join('/home', '.cache', 'pnpm'))
    expect(licenseAuditStoreDirectory({}, '/home', 'linux')).toBe(
      join('/home', '.cache', 'pnpm', 'dependency-license-audit-store'),
    )
  })

  it('rejects a store that is not an owned real directory', () => {
    const stat = {
      isDirectory: () => false,
      isSymbolicLink: () => false,
      mode: 0o700,
      uid: 4,
    }
    expect(() => assertOwnedDirectory(stat, 4, '/store')).toThrow(/not a real directory/)
    expect(() =>
      assertOwnedDirectory(
        { ...stat, isDirectory: () => true, isSymbolicLink: () => true },
        4,
        '/store',
      ),
    ).toThrow(/not a real directory/)
    expect(() => assertOwnedDirectory({ ...stat, isDirectory: () => true }, 5, '/store')).toThrow(
      /not owned/,
    )
    expect(() =>
      assertOwnedDirectory({ ...stat, isDirectory: () => true }, undefined, '/store'),
    ).not.toThrow()
  })

  it('creates an owner-only store and tightens a loose directory', () => {
    const parent = tempDirectory()
    try {
      const store = join(parent, 'store')
      ensurePrivateLicenseAuditStore(store)
      expect(lstatSync(store).mode & 0o077).toBe(0)
      chmodSync(store, 0o755)
      ensurePrivateLicenseAuditStore(store)
      expect(lstatSync(store).mode & 0o077).toBe(0)
    } finally {
      rmSync(parent, { force: true, recursive: true })
    }
  })

  it('rejects a file or a symlink at the store path', () => {
    const parent = tempDirectory()
    try {
      const file = join(parent, 'file')
      writeFileSync(file, 'x')
      expect(() => ensurePrivateLicenseAuditStore(file)).toThrow()
      const target = join(parent, 'target')
      mkdirSync(target)
      const link = join(parent, 'link')
      symlinkSync(target, link)
      expect(() => ensurePrivateLicenseAuditStore(link)).toThrow(/not a real directory/)
      expect(lstatSync(target).isDirectory()).toBe(true)
    } finally {
      rmSync(parent, { force: true, recursive: true })
    }
  })
})
