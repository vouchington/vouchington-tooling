import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import ts from '@typescript/typescript6'
import { describe, expect, it } from 'vitest'

import { compilerHostProbesAreFresh, trackCompilerHost } from './freshness.mts'
import { settleBuild } from './settlement.mts'

describe('compiler host probes', () => {
  it('tracks a real compiler read and detects a changed input', () => {
    const root = mkdtempSync(join(tmpdir(), 'compiler-host-probes-'))
    try {
      const entry = join(root, 'entry.mts')
      writeFileSync(entry, 'export const value = 1\n')
      const options: ts.CompilerOptions = {
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        target: ts.ScriptTarget.ESNext,
        noLib: true,
        noEmit: true,
        types: [],
      }
      const tracker = trackCompilerHost(ts.createCompilerHost(options))
      const program = ts.createProgram([entry], options, tracker.host)
      expect(program.getSourceFile(entry)).toBeDefined()
      expect(compilerHostProbesAreFresh(tracker.snapshot())).toBe(true)
      writeFileSync(entry, 'export const value = 2\n')
      expect(compilerHostProbesAreFresh(tracker.snapshot())).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('preserves a virtual host and detects repeated reads that disagree', () => {
    let contents = 'first'
    const original = { fileExists: () => true, readFile: (_path: string) => contents }
    const tracker = trackCompilerHost(original)
    expect(tracker.host).toBe(original)
    expect(tracker.host.readFile('virtual.mts')).toBe('first')
    contents = 'second'
    expect(tracker.host.readFile('virtual.mts')).toBe('second')
    expect(tracker.snapshot().stableDuringCapture).toBe(false)
    expect(compilerHostProbesAreFresh(tracker.snapshot())).toBe(false)
  })

  it('uses metadata replay only on explicit opt-in', () => {
    const root = mkdtempSync(join(tmpdir(), 'compiler-host-metadata-'))
    try {
      const path = join(root, 'disk.mts')
      writeFileSync(path, 'source')
      let reads = 0
      const tracker = trackCompilerHost(
        {
          fileExists: () => true,
          readFile: (file: string) => {
            reads += 1
            return readFileSync(file, 'utf8')
          },
        },
        { readFileReplay: 'when-filesystem-metadata-stable' },
      )
      expect(tracker.host.readFile(path)).toBe('source')
      expect(compilerHostProbesAreFresh(tracker.snapshot())).toBe(true)
      expect(reads).toBe(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('bounded settlement', () => {
  it('rebuilds with the latest configuration until confirmation succeeds', () => {
    const built: number[] = []
    const result = settleBuild(1, 3, {
      buildAttempt: (revision) => {
        built.push(revision)
        return `value-${revision}`
      },
      confirmAttempt: (revision) => ({ configuration: revision + 1, settled: revision === 2 }),
    })
    expect(result).toBe('value-2')
    expect(built).toEqual([1, 2])
  })

  it('rejects invalid budgets and stops exactly at the caller budget', () => {
    let attempts = 0
    const callbacks = {
      buildAttempt: (revision: number) => {
        attempts += 1
        return revision
      },
      confirmAttempt: (revision: number) => ({ configuration: revision + 1, settled: false }),
    }
    expect(() => settleBuild(0, 0, callbacks)).toThrow(RangeError)
    expect(attempts).toBe(0)
    expect(() => settleBuild(0, 2, callbacks)).toThrow(
      'Inputs changed during 2 consecutive build attempts',
    )
    expect(attempts).toBe(2)
  })
})
