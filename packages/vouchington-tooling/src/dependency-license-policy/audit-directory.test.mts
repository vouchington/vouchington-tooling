import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  isAuditOwnerAlive,
  isProcessAlive,
  parseProcessStart,
  readProcessStartMs,
  reclaimStaleLicenseAuditDirectories,
  removeAuditDirectory,
} from './audit-directory.mts'

const DEAD_PID = 2_147_483_647

function tempDirectory(): string {
  return mkdtempSync(join(tmpdir(), 'license-audit-reclaim-'))
}

function makeAuditDirectory(parent: string, name: string): string {
  const directory = join(parent, name)
  mkdirSync(directory)
  return directory
}

function ageDirectory(directory: string, mtimeMs: number): void {
  const mtime = new Date(mtimeMs)
  utimesSync(directory, mtime, mtime)
}

describe('license audit directory reclaim', () => {
  it('parses process start dates and rejects unparseable text', () => {
    expect(parseProcessStart('Sat Sep 26 01:58:39 2026')).toBe(
      Date.parse('Sat Sep 26 01:58:39 2026'),
    )
    expect(parseProcessStart('not a date')).toBeUndefined()
  })

  it('reads the start time of a live process and ignores a dead pid', () => {
    expect(readProcessStartMs(process.pid)).toEqual(expect.any(Number))
    expect(readProcessStartMs(DEAD_PID)).toBeUndefined()
  })

  it('treats signal 0 checks as alive only for a real positive pid', () => {
    expect(isProcessAlive(process.pid)).toBe(true)
    expect(isProcessAlive(1)).toBe(true)
    expect(isProcessAlive(0)).toBe(false)
    expect(isProcessAlive(-1)).toBe(false)
    expect(isProcessAlive(1.5)).toBe(false)
    expect(isProcessAlive(DEAD_PID)).toBe(false)
    expect(isProcessAlive(2_147_483_648)).toBe(false)
  })

  it('keeps an owner whose process started before the directory', () => {
    expect(isAuditOwnerAlive(process.pid, Date.now())).toBe(true)
    expect(isAuditOwnerAlive(DEAD_PID, Date.now())).toBe(false)
    expect(
      isAuditOwnerAlive(process.pid, 0, {
        isProcessAlive: () => true,
        readProcessStartMs: () => undefined,
      }),
    ).toBe(true)
    expect(
      isAuditOwnerAlive(process.pid, 0, {
        isProcessAlive: () => true,
        readProcessStartMs: () => Date.now(),
      }),
    ).toBe(false)
    expect(
      isAuditOwnerAlive(process.pid, Date.now(), {
        isProcessAlive: () => true,
        readProcessStartMs: () => Date.now() - 10_000,
      }),
    ).toBe(true)
    expect(isAuditOwnerAlive(process.pid, Date.now(), { isProcessAlive: () => false })).toBe(false)
  })

  it('removes directories whose owner is gone and keeps live or fresh ones', () => {
    const parent = tempDirectory()
    try {
      const now = Date.parse('2026-09-26T00:00:00Z')
      const dead = makeAuditDirectory(parent, 'dependency-license-audit-dead')
      writeFileSync(join(dead, 'audit.pid'), `${String(DEAD_PID)}\n`)
      const live = makeAuditDirectory(parent, 'dependency-license-audit-live')
      writeFileSync(join(live, 'audit.pid'), `${String(process.pid)}\n`)
      const old = makeAuditDirectory(parent, 'dependency-license-audit-old')
      ageDirectory(old, now - 120_000)
      makeAuditDirectory(parent, 'dependency-license-audit-fresh')
      const invalid = makeAuditDirectory(parent, 'dependency-license-audit-invalid')
      writeFileSync(join(invalid, 'audit.pid'), 'nope\n')
      ageDirectory(invalid, now - 120_000)
      const unsafe = makeAuditDirectory(parent, 'dependency-license-audit-unsafe')
      writeFileSync(join(unsafe, 'audit.pid'), '9007199254740993\n')
      ageDirectory(unsafe, now - 120_000)
      const keptInvalid = makeAuditDirectory(parent, 'dependency-license-audit-kept')
      writeFileSync(join(keptInvalid, 'audit.pid'), '\n')
      mkdirSync(join(parent, 'unrelated'))
      writeFileSync(join(parent, 'dependency-license-audit-file'), 'keep\n')
      const target = makeAuditDirectory(parent, 'target')
      writeFileSync(join(target, 'marker'), 'safe\n')
      symlinkSync(target, join(parent, 'dependency-license-audit-link'))

      reclaimStaleLicenseAuditDirectories(parent, { now })

      expect(readdirSync(parent).toSorted()).toEqual([
        'dependency-license-audit-file',
        'dependency-license-audit-fresh',
        'dependency-license-audit-kept',
        'dependency-license-audit-live',
        'target',
        'unrelated',
      ])
      expect(readMarker(target)).toBe('safe\n')
    } finally {
      rmSync(parent, { force: true, recursive: true })
    }
  })

  it('uses an injected owner check and ignores a missing parent', () => {
    const parent = tempDirectory()
    try {
      const directory = makeAuditDirectory(parent, 'dependency-license-audit-injected')
      writeFileSync(join(directory, 'audit.pid'), '424242\n')
      reclaimStaleLicenseAuditDirectories(parent, { isOwnerAlive: () => true })
      expect(readdirSync(parent)).toEqual(['dependency-license-audit-injected'])
      reclaimStaleLicenseAuditDirectories(parent, { isOwnerAlive: () => false })
      expect(readdirSync(parent)).toEqual([])
      expect(() => reclaimStaleLicenseAuditDirectories(join(parent, 'missing'))).not.toThrow()
    } finally {
      rmSync(parent, { force: true, recursive: true })
    }
  })

  it('rethrows unexpected directory reads and pid-file errors', () => {
    const parent = tempDirectory()
    const file = join(parent, 'not-a-directory')
    writeFileSync(file, 'x')
    const blocked = makeAuditDirectory(parent, 'dependency-license-audit-blocked')
    writeFileSync(join(blocked, 'audit.pid'), '1\n')
    chmodSync(blocked, 0)
    try {
      expect(() => reclaimStaleLicenseAuditDirectories(file)).toThrow()
      expect(() => reclaimStaleLicenseAuditDirectories(parent)).toThrow()
    } finally {
      chmodSync(blocked, 0o700)
      rmSync(parent, { force: true, recursive: true })
    }
  })

  it('removes a real directory or a symlink and ignores other paths', () => {
    const parent = tempDirectory()
    try {
      const directory = makeAuditDirectory(parent, 'directory')
      const target = makeAuditDirectory(parent, 'target')
      writeFileSync(join(target, 'marker'), 'safe\n')
      const link = join(parent, 'link')
      symlinkSync(target, link)
      const file = join(parent, 'file')
      writeFileSync(file, 'keep\n')
      removeAuditDirectory(directory)
      removeAuditDirectory(link)
      removeAuditDirectory(file)
      removeAuditDirectory(join(parent, 'missing'))
      expect(existsPath(directory)).toBe(false)
      expect(existsPath(link)).toBe(false)
      expect(readMarker(target)).toBe('safe\n')
      expect(readMarker(parent, 'file')).toBe('keep\n')
    } finally {
      rmSync(parent, { force: true, recursive: true })
    }
  })
})

function existsPath(path: string): boolean {
  return lstatSync(path, { throwIfNoEntry: false }) !== undefined
}

function readMarker(directory: string, name = 'marker'): string {
  return readFileSync(join(directory, name), 'utf8')
}
