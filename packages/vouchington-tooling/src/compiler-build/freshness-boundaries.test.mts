import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { compilerHostProbesAreFresh, trackCompilerHost } from './freshness.mts'

describe('compiler host filesystem decisions', () => {
  it('replays existence, directory listing, and realpath decisions', () => {
    let exists = false
    let directory = false
    let directories = ['z', 'a', 'a']
    let files = ['b.mts', 'a.mts']
    let resolved = '/source/first.mts'
    const host = {
      prefix: '/source',
      fileExists(path: string) {
        return exists && path.startsWith(this.prefix)
      },
      directoryExists(path: string) {
        return directory && path === this.prefix
      },
      getDirectories: (_path: string) => directories,
      readDirectory: (_path: string, _extensions?: readonly string[]) => files,
      realpath: (_path: string) => resolved,
      readFile: (_path: string) => undefined,
    }
    const tracked = trackCompilerHost(host)
    expect(tracked.host.fileExists('/source/entry.mts')).toBe(false)
    expect(tracked.host.directoryExists('/source')).toBe(false)
    expect(tracked.host.getDirectories('/source')).toEqual(['z', 'a', 'a'])
    expect(tracked.host.readDirectory('/source', ['.mts'])).toEqual(['b.mts', 'a.mts'])
    expect(tracked.host.realpath('/source/link.mts')).toBe('/source/first.mts')
    expect(compilerHostProbesAreFresh(tracked.snapshot())).toBe(true)
    directories = ['a', 'z']
    files = ['a.mts', 'b.mts']
    expect(compilerHostProbesAreFresh(tracked.snapshot())).toBe(true)
    exists = true
    directory = true
    resolved = '/source/second.mts'
    expect(compilerHostProbesAreFresh(tracked.snapshot())).toBe(false)
  })

  it('marks a build unstable when a post-read hook observes a mutation', () => {
    const tracked = trackCompilerHost(
      { fileExists: () => true, readFile: (_path: string) => 'before' },
      { afterRead: () => true },
    )
    expect(tracked.host.readFile('virtual.mts')).toBe('before')
    expect(tracked.snapshot().stableDuringCapture).toBe(false)
    expect(compilerHostProbesAreFresh(tracked.snapshot())).toBe(false)
  })

  it('detects disk mutation during capture and metadata changes after capture', () => {
    const root = mkdtempSync(join(tmpdir(), 'compiler-host-race-'))
    try {
      const path = join(root, 'entry.mts')
      writeFileSync(path, 'first')
      const racing = trackCompilerHost(
        {
          fileExists: () => true,
          readFile: (file: string) => {
            const value = readFileSync(file, 'utf8')
            writeFileSync(file, 'second-value')
            return value
          },
        },
        { readFileReplay: 'when-filesystem-metadata-stable' },
      )
      expect(racing.host.readFile(path)).toBe('first')
      expect(racing.snapshot().stableDuringCapture).toBe(false)

      const stable = trackCompilerHost(
        { fileExists: () => true, readFile: (file: string) => readFileSync(file, 'utf8') },
        { readFileReplay: 'when-filesystem-metadata-stable' },
      )
      expect(stable.host.readFile(path)).toBe('second-value')
      expect(compilerHostProbesAreFresh(stable.snapshot())).toBe(true)
      writeFileSync(path, 'third-value')
      expect(compilerHostProbesAreFresh(stable.snapshot())).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('handles missing metadata and propagates unexpected metadata errors', () => {
    const root = mkdtempSync(join(tmpdir(), 'compiler-host-missing-'))
    try {
      const missingPath = join(root, 'absent.mts')
      const tracked = trackCompilerHost(
        { fileExists: () => false, readFile: (_path: string) => undefined },
        { readFileReplay: 'when-filesystem-metadata-stable' },
      )
      expect(tracked.host.readFile(missingPath)).toBeUndefined()
      expect(compilerHostProbesAreFresh(tracked.snapshot())).toBe(true)
      expect(() => tracked.host.readFile('\0')).toThrow()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('treats removed inputs as stale and propagates unexpected replay failures', () => {
    const missing = Object.assign(new Error('removed'), { code: 'ENOENT' })
    const unexpected = new Error('permission denied')
    expect(
      compilerHostProbesAreFresh({
        stableDuringCapture: true,
        probes: [
          {
            key: 'missing',
            value: 'old',
            replay: () => {
              throw missing
            },
          },
        ],
      }),
    ).toBe(false)
    expect(() =>
      compilerHostProbesAreFresh({
        stableDuringCapture: true,
        probes: [
          {
            key: 'unexpected',
            value: 'old',
            replay: () => {
              throw unexpected
            },
          },
        ],
      }),
    ).toThrow(unexpected)
  })
})
