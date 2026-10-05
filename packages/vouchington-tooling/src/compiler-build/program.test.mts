import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from '@typescript/typescript6'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCompilerProgramCache } from './program.mts'

describe('compiler program cache', () => {
  let root: string
  let configPath: string
  let entry: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'compiler-cache-'))
    configPath = join(root, 'tsconfig.json')
    entry = join(root, 'entry.mts')
    writeFileSync(entry, 'export const value = 1\n')
    writeConfiguration()
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  function writeConfiguration(extra: Record<string, unknown> = {}) {
    writeFileSync(
      configPath,
      JSON.stringify({
        compilerOptions: { noLib: true, types: [], strict: true, noEmit: true },
        files: ['entry.mts'],
        ...extra,
      }),
    )
  }

  it('reuses identity when warm, rebuilds changed source, and clears without resetting the count', () => {
    const cache = createCompilerProgramCache({ configPath })
    const first = cache.load()
    expect(first.sourceFiles.map((file) => file.fileName)).toEqual([entry])
    expect(cache.load()).toBe(first)
    expect(cache.buildCount).toBe(1)
    writeFileSync(entry, 'export const value = 2\n')
    const second = cache.load()
    expect(second.generation).not.toBe(first.generation)
    expect(second.program.getSourceFile(entry)?.text).toContain('value = 2')
    expect(cache.buildCount).toBe(2)
    cache.clear()
    expect(cache.load().generation).not.toBe(second.generation)
    expect(cache.buildCount).toBe(3)
  })

  it('rebuilds changed configuration and selected roots', () => {
    const other = join(root, 'other.mts')
    writeFileSync(other, 'export const other = true\n')
    const roots = ['entry.mts']
    const cache = createCompilerProgramCache({ ts, configPath, rootNames: roots })
    const first = cache.load()
    roots.push('other.mts')
    expect(cache.load().sourceFiles.map((file) => file.fileName)).toEqual([entry, other])
    writeConfiguration({ compilerOptions: { noLib: true, types: [], strict: false } })
    expect(cache.load().program.getCompilerOptions().strict).toBe(false)
    expect(cache.load().generation).not.toBe(first.generation)
    expect(cache.buildCount).toBe(3)
  })

  it('supports callback roots and source selection without conflating source identity', () => {
    const other = join(root, 'other.mts')
    writeFileSync(other, 'export const other = true\n')
    writeConfiguration({ files: ['entry.mts', 'other.mts'] })
    const selected = ['entry.mts', 'missing.mts']
    const cache = createCompilerProgramCache({
      ts,
      configPath,
      rootNames: (configuration) => configuration.fileNames,
      sourceFilePaths: () => selected,
    })
    const first = cache.load()
    expect(first.sourceFiles.map((file) => file.fileName)).toEqual([entry])
    selected.splice(0, selected.length, 'other.mts')
    const second = cache.load()
    expect(second.sourceFiles.map((file) => file.fileName)).toEqual([other])
    expect(second.generation).not.toBe(first.generation)
    expect(cache.load()).toBe(second)
  })

  it('accepts an empty exact source selection', () => {
    const cache = createCompilerProgramCache({ ts, configPath, sourceFilePaths: [] })
    expect(cache.load().sourceFiles).toEqual([])
    expect(cache.buildCount).toBe(1)
  })

  it('preserves changed root order rather than returning an older source order', () => {
    const other = join(root, 'other.mts')
    writeFileSync(other, 'export const other = true\n')
    const roots = ['entry.mts', 'other.mts']
    const cache = createCompilerProgramCache({ ts, configPath, rootNames: roots })
    const first = cache.load()
    expect(first.program.getRootFileNames()).toEqual([entry, other])
    roots.reverse()
    const second = cache.load()
    expect(second.program.getRootFileNames()).toEqual([other, entry])
    expect(second.sourceFiles.map((file) => file.fileName)).toEqual([other, entry])
    expect(second.generation).not.toBe(first.generation)
  })

  it('includes host probes recorded after program construction', () => {
    let host: ts.CompilerHost | undefined
    const compiler = {
      ...ts,
      createProgram: ((input: ts.CreateProgramOptions) => {
        host = input.host
        return ts.createProgram(input)
      }) as typeof ts.createProgram,
    }
    const cache = createCompilerProgramCache({ ts: compiler, configPath })
    const first = cache.load()
    const late = join(root, 'late-input.json')
    writeFileSync(late, 'one')
    expect(host?.readFile(late)).toBe('one')
    expect(cache.load()).toBe(first)
    writeFileSync(late, 'two')
    expect(cache.load().generation).not.toBe(first.generation)
    expect(cache.buildCount).toBe(2)
  })

  it('settles a source/configuration change during the first build', () => {
    let changed = false
    const cache = createCompilerProgramCache({
      ts,
      configPath,
      tracking: {
        afterRead(path) {
          if (path === entry && !changed) {
            changed = true
            writeFileSync(entry, 'export const value = 22\n')
            writeConfiguration({ compilerOptions: { noLib: true, types: [], strict: false } })
          }
        },
      },
    })
    const settled = cache.load()
    expect(settled.program.getSourceFile(entry)?.text).toContain('value = 22')
    expect(settled.program.getCompilerOptions().strict).toBe(false)
    expect(cache.buildCount).toBe(2)
    expect(cache.load()).toBe(settled)
  })

  it('bounds unstable builds and does not cache their programs', () => {
    let unstable = true
    const cache = createCompilerProgramCache({
      ts,
      configPath,
      maximumAttempts: 2,
      tracking: { afterRead: () => unstable },
    })
    expect(() => cache.load()).toThrow('Inputs changed during 2 consecutive build attempts')
    expect(cache.buildCount).toBe(2)
    unstable = false
    expect(cache.load().sourceFiles.map((file) => file.fileName)).toEqual([entry])
    expect(cache.buildCount).toBe(3)
  })

  it('rejects an invalid retry bound before constructing any program', () => {
    const cache = createCompilerProgramCache({ ts, configPath, maximumAttempts: 0 })
    expect(() => cache.load()).toThrow('maximumAttempts must be a positive safe integer')
    expect(cache.buildCount).toBe(0)
  })

  it('reports malformed and missing configurations, then recovers', () => {
    const cache = createCompilerProgramCache({ ts, configPath })
    writeFileSync(configPath, '{')
    expect(() => cache.load()).toThrow()
    writeConfiguration({ compilerOptions: { target: 'not-a-target' } })
    expect(() => cache.load()).toThrow('target')
    rmSync(configPath)
    expect(() => cache.load()).toThrow('Cannot read file')
    writeConfiguration()
    expect(cache.load().sourceFiles.map((file) => file.fileName)).toEqual([entry])
  })

  it('releases an old generation when a configuration read fails', () => {
    const cache = createCompilerProgramCache({ ts, configPath })
    const first = cache.load()
    writeFileSync(configPath, '{')
    expect(() => cache.load()).toThrow()
    writeConfiguration()
    expect(cache.load().generation).not.toBe(first.generation)
    expect(cache.buildCount).toBe(2)
  })

  it('includes imported sources and invalidates a failed module lookup becoming available', () => {
    writeFileSync(entry, "import { value } from './dependency.mjs'\nexport { value }\n")
    const cache = createCompilerProgramCache({ ts, configPath })
    const first = cache.load()
    const dependency = join(root, 'dependency.mts')
    writeFileSync(dependency, 'export const value = 9\n')
    const second = cache.load()
    expect(second.generation).not.toBe(first.generation)
    expect(second.sourceFiles.some((file) => file.fileName === dependency)).toBe(true)
  })

  it('tracks extended configuration changes', () => {
    const base = join(root, 'base.json')
    writeFileSync(base, JSON.stringify({ compilerOptions: { strict: false } }))
    writeConfiguration({ compilerOptions: { noLib: true, types: [] }, extends: './base.json' })
    const cache = createCompilerProgramCache({ ts, configPath })
    const first = cache.load()
    writeFileSync(base, readFileSync(base, 'utf8').replace('false', 'true'))
    expect(cache.load().program.getCompilerOptions().strict).toBe(true)
    expect(cache.load().generation).not.toBe(first.generation)
  })

  it('tracks project-reference changes in the configuration signature', () => {
    writeConfiguration({ references: [{ path: './project' }] })
    const cache = createCompilerProgramCache({ ts, configPath })
    const first = cache.load()
    expect(first.program.getProjectReferences()?.[0]?.path).toBe(join(root, 'project'))
    writeConfiguration({ references: [{ path: './other-project' }] })
    expect(cache.load().generation).not.toBe(first.generation)
  })
})
