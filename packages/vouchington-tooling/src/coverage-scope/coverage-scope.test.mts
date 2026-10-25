import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadCoverageConfig } from 'coverage-check'
import { describe, expect, it } from 'vitest'
import { checkCoverageScope, findCoverageScopeMismatches, listTrackedFiles } from './index.mts'
import { fixtureRepo } from './coverage-scope.test-helpers.mts'

const instrumentedScope = { include: ['**/*.mts'], exclude: ['app/dev.mts'] }

describe('findCoverageScopeMismatches', () => {
  const cwd = fixtureRepo([], { git: false })
  const config = loadCoverageConfig(join(cwd, '.coverage-rules.yml'))
  const scope = { version: 1 as const, analyzer: 'javascript' as const, include: ['**/*.mts'] }

  it('reports positive-threshold files the collector excludes', () => {
    const files = ['app/dev.mts', 'app/ok.mts']
    expect(
      findCoverageScopeMismatches(files, config, { ...scope, ignored: ['app/dev.mts'] }),
    ).toEqual(['app/dev.mts'])
  })

  it('skips ignored, zero-threshold and unmatched files', () => {
    const files = ['app/a.test.mts', 'scripts/a.mts', 'other/a.mts']
    expect(findCoverageScopeMismatches(files, config, { ...scope, ignored: ['**/*'] })).toEqual([])
  })

  it('requires a scope block', () => {
    const { scope: _omitted, ...withoutScope } = config
    expect(() => findCoverageScopeMismatches([], withoutScope, { ...scope, ignored: [] })).toThrow(
      'missing its scope block',
    )
  })
})

describe('checkCoverageScope', () => {
  it('lists tracked files from git', () => {
    const cwd = fixtureRepo(['app/a.mts'], { git: true })
    expect(listTrackedFiles(cwd).sort()).toEqual(['.coverage-rules.yml', 'app/a.mts'])
  })

  it('returns mismatches for git-tracked files', () => {
    const cwd = fixtureRepo(['app/dev.mts', 'app/ok.mts'], { git: true })
    expect(checkCoverageScope({ cwd, instrumentedScope })).toEqual(['app/dev.mts'])
  })

  it('uses an injected lister and a custom rules file', () => {
    const cwd = fixtureRepo([], { git: false })
    writeFileSync(join(cwd, 'rules.yml'), 'rules:\n  - paths: "**"\n    patch_coverage_min: 1\n')
    const listFiles = () => ['x.mts']
    expect(() =>
      checkCoverageScope({ cwd, rulesFile: 'rules.yml', instrumentedScope, listFiles }),
    ).toThrow('missing its scope block')
    expect(
      checkCoverageScope({ cwd, instrumentedScope, listFiles: () => ['app/dev.mts'] }),
    ).toEqual(['app/dev.mts'])
  })
})
