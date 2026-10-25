import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fixtureRepo } from '../../coverage-scope/coverage-scope.test-helpers.mts'
import { runCoverageScopeCheckCommand } from './coverage-scope-check.mts'

let stderr = ''

beforeEach(() => {
  stderr = ''
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr += String(chunk)
    return true
  })
})

afterEach(() => vi.restoreAllMocks())

describe('runCoverageScopeCheckCommand', () => {
  it('passes when every required file is instrumented', () => {
    const cwd = fixtureRepo(['app/a.mts'], { git: true })
    expect(runCoverageScopeCheckCommand(['--include', '**/*.mts'], cwd)).toBe(0)
  })

  it('prints each mismatch and exits 1', () => {
    const cwd = fixtureRepo(['app/dev.mts', 'app/ok.mts'], { git: true })
    const args = ['--include', '**/*.mts', '--exclude', 'app/dev.mts']
    expect(runCoverageScopeCheckCommand(args, cwd)).toBe(1)
    expect(stderr).toContain('  app/dev.mts')
    expect(stderr).not.toContain('app/ok.mts')
  })

  it('reads the scope from a JSON file and a custom rules path', () => {
    const cwd = fixtureRepo(['app/dev.mts'], { git: true })
    writeFileSync(
      join(cwd, 'scope.json'),
      JSON.stringify({ include: ['**/*.mts'], exclude: ['app/**'] }),
    )
    expect(runCoverageScopeCheckCommand(['--scope-file', 'scope.json'], cwd)).toBe(1)
    const args = ['--rules', 'missing.yml', '--include', '**']
    expect(runCoverageScopeCheckCommand(args, cwd)).toBe(1)
    expect(stderr).toContain('vouchington:')
  })

  it('treats a missing include, a bad file or a bad flag as a usage error', () => {
    const cwd = fixtureRepo([], { git: false })
    writeFileSync(join(cwd, 'bad.json'), JSON.stringify({ include: 'x' }))
    writeFileSync(join(cwd, 'empty.json'), '{}')
    expect(runCoverageScopeCheckCommand([], cwd)).toBe(2)
    expect(stderr).toContain('at least one include glob is required')
    expect(runCoverageScopeCheckCommand(['--scope-file', join(cwd, 'bad.json')], cwd)).toBe(2)
    expect(stderr).toContain('"include" must be an array of strings')
    expect(runCoverageScopeCheckCommand(['--scope-file', join(cwd, 'empty.json')], cwd)).toBe(2)
    expect(runCoverageScopeCheckCommand(['--nope'], cwd)).toBe(2)
  })
})
