import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { clearForkExitRecords, readForkExitRecords } from './vitest-fork-exit-records.mts'
import {
  formatPercent,
  registerForkExitSentinel,
  setCurrentForkExitModule,
  setCurrentForkExitProject,
} from './vitest-fork-exit-sentinel.mts'

const registered = Symbol.for('vouchington-tooling.vitest-fork-exit-sentinel.registered')
const directories: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  delete (globalThis as Record<symbol, unknown>)[registered]
  setCurrentForkExitModule(null)
  setCurrentForkExitProject(undefined)
  for (const directory of directories.splice(0)) {
    clearForkExitRecords(directory)
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('fork exit sentinel lifecycle', () => {
  it('formats a zero heap limit safely', () => {
    expect(formatPercent(1, 0)).toBe('0.0')
  })

  it('fails before registration when the runtime cannot terminate a fork directly', () => {
    const original = Object.getOwnPropertyDescriptor(process, 'reallyExit')
    Object.defineProperty(process, 'reallyExit', { configurable: true, value: undefined })
    try {
      expect(() => registerForkExitSentinel({ recordDirectory: 'unused' })).toThrow(
        'process.reallyExit is unavailable',
      )
    } finally {
      if (original) Object.defineProperty(process, 'reallyExit', original)
    }
  })

  it('records normal exit and fatal event attribution, without installing duplicate listeners', () => {
    const directory = mkdtempSync(join(tmpdir(), 'fork-sentinel-'))
    directories.push(directory)
    const listeners = new Map<string, (...args: unknown[]) => void>()
    vi.spyOn(process, 'on').mockImplementation((event, listener) => {
      listeners.set(String(event), listener as (...args: unknown[]) => void)
      return process
    })
    const exit = vi.spyOn(process, 'reallyExit').mockImplementation((code?: number) => {
      throw new Error(`reallyExit:${code}`)
    })
    expect(() => registerForkExitSentinel({ recordDirectory: '' })).toThrow(
      'recordDirectory is required',
    )
    registerForkExitSentinel({ recordDirectory: directory })
    expect(listeners.size).toBe(6)
    registerForkExitSentinel({ recordDirectory: directory })
    expect(listeners.size).toBe(6)
    expect(() => registerForkExitSentinel({ recordDirectory: `${directory}-other` })).toThrow(
      'different directory',
    )
    listeners.get('exit')!(0)
    setCurrentForkExitProject('synthetic-project')
    setCurrentForkExitModule('synthetic.test.mts')
    listeners.get('exit')!(0)
    expect(() => listeners.get('uncaughtException')!(new Error('bad\nline'))).toThrow(
      'reallyExit:1',
    )
    expect(() => listeners.get('unhandledRejection')!('rejected')).toThrow('reallyExit:1')
    expect(() => listeners.get('SIGTERM')!()).toThrow(/reallyExit:1\d\d/)
    expect(() => listeners.get('SIGINT')!()).toThrow(/reallyExit:1\d\d/)
    expect(() => listeners.get('SIGHUP')!()).toThrow(/reallyExit:1\d\d/)
    expect(exit).toHaveBeenCalledTimes(5)
    const records = readForkExitRecords(directory)
    expect(records[0]).toEqual({ kind: 'start', pid: process.pid })
    expect(records.slice(1)).toMatchObject([
      { kind: 'exit', mode: 'exit', project: 'unknown', module: 'none' },
      { kind: 'exit', mode: 'exit', project: 'synthetic-project', module: 'synthetic.test.mts' },
      { kind: 'exit', mode: 'uncaught', errorMessage: 'bad\nline' },
      { kind: 'exit', mode: 'unhandled', errorMessage: 'rejected' },
      { kind: 'exit', mode: 'signal:SIGTERM' },
      { kind: 'exit', mode: 'signal:SIGINT' },
      { kind: 'exit', mode: 'signal:SIGHUP' },
    ])
  })
})
