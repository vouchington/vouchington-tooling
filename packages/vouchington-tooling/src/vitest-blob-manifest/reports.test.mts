import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { writeVitestBlobManifest, type VitestBlobIdentity } from './index.mts'
import { prepareVitestReports, type PrepareVitestReportsOptions } from './reports.mts'

const revision = 'a'.repeat(40)
const identity: VitestBlobIdentity = {
  suite: 'backend-shard-1',
  repository: 'owner/repo',
  revision,
  runId: '9131',
  runAttempt: 2,
}

describe('prepareVitestReports', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'vitest-reports-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function options(
    expectedSuites = [identity.suite],
    currentAttempt = 2,
    minimumAttempt = 1,
  ): PrepareVitestReportsOptions {
    return {
      primaryDir: join(root, 'primary'),
      fallbackDir: join(root, 'fallback'),
      outputDir: join(root, 'output'),
      expectedSuites: expectedSuites.map((suite) => ({ suite, minimumAttempt })),
      repository: identity.repository,
      revision,
      run: { id: identity.runId, currentAttempt },
    }
  }

  function bundle(
    source: 'primary' | 'fallback',
    name: string,
    bundleIdentity: VitestBlobIdentity = identity,
    report = `{"attempt":${bundleIdentity.runAttempt}}\n`,
    flattened = false,
  ): string {
    const sourceRoot = join(root, source)
    mkdirSync(sourceRoot, { recursive: true })
    const directory = flattened ? sourceRoot : join(sourceRoot, name)
    if (!flattened) mkdirSync(directory)
    writeFileSync(join(directory, `${bundleIdentity.suite}.json`), report)
    writeVitestBlobManifest(directory, bundleIdentity)
    return directory
  }

  it('selects the latest trusted reports, normalizes flattened artifacts, and atomically replaces output', () => {
    bundle('primary', 'old', { ...identity, runAttempt: 1 }, '{"attempt":1}\n')
    bundle('fallback', 'new', identity, '{"attempt":2}\n')
    const tooling = { ...identity, suite: 'tooling' }
    bundle('primary', 'tooling', tooling, '{"suite":"tooling"}\n')
    mkdirSync(join(root, 'output'))
    writeFileSync(join(root, 'output', 'stale.json'), '{}')

    expect(prepareVitestReports(options(['tooling', identity.suite])).selected).toEqual([
      { suite: identity.suite, attempt: 2, sources: ['fallback'] },
      { suite: 'tooling', attempt: 2, sources: ['primary'] },
    ])
    expect(readdirSync(join(root, 'output'))).toEqual([`${identity.suite}.json`, 'tooling.json'])
    expect(readFileSync(join(root, 'output', `${identity.suite}.json`), 'utf8')).toBe(
      '{"attempt":2}\n',
    )

    rmSync(join(root, 'primary'), { recursive: true })
    rmSync(join(root, 'fallback'), { recursive: true })
    bundle('fallback', 'unused', identity, '{"flattened":true}\n', true)
    expect(prepareVitestReports(options()).selected).toEqual([
      { suite: identity.suite, attempt: 2, sources: ['fallback'] },
    ])
  })

  it('accepts byte-identical copies and rejects conflicting, missing, duplicate, and unexpected reports', () => {
    bundle('primary', 'one')
    bundle('fallback', 'two')
    expect(prepareVitestReports(options()).selected[0]).toEqual({
      suite: identity.suite,
      attempt: 2,
      sources: ['fallback', 'primary'],
    })

    rmSync(join(root, 'primary'), { recursive: true })
    rmSync(join(root, 'fallback'), { recursive: true })
    bundle('primary', 'one', identity, '{"primary":true}\n')
    bundle('fallback', 'two', identity, '{"fallback":true}\n')
    expect(() => prepareVitestReports(options())).toThrow('Conflicting Vitest blobs')

    rmSync(join(root, 'primary'), { recursive: true })
    rmSync(join(root, 'fallback'), { recursive: true })
    bundle('primary', 'expected')
    expect(() => prepareVitestReports(options([identity.suite, 'tooling']))).toThrow(
      'Missing expected',
    )
    expect(() => prepareVitestReports(options([identity.suite, identity.suite]))).toThrow(
      'must be unique',
    )
    bundle('fallback', 'unexpected', { ...identity, suite: 'tooling' })
    expect(() => prepareVitestReports(options())).toThrow('Unexpected current-attempt')
  })

  it('fails closed for malformed layouts, bundles, identities, future attempts, and invalid options', () => {
    const cases: Array<{ readonly message: string; readonly mutate: () => void }> = [
      {
        message: 'invalid archive marker',
        mutate: () => {
          bundle('primary', 'owned')
          writeFileSync(join(root, 'primary', '.invalid-tooling'), 'invalid')
        },
      },
      {
        message: 'unexpected entry',
        mutate: () => {
          mkdirSync(join(root, 'primary'), { recursive: true })
          writeFileSync(join(root, 'primary', 'unowned'), '')
        },
      },
      {
        message: 'Invalid Vitest blob bundle',
        mutate: () => {
          const directory = bundle('primary', 'malformed')
          writeFileSync(join(directory, 'vitest-blob-manifest.json'), '{}')
        },
      },
      {
        message: 'identity does not match',
        mutate: () => bundle('primary', 'foreign', { ...identity, repository: 'other/repo' }),
      },
      {
        message: 'from the future',
        mutate: () => bundle('primary', 'future', { ...identity, runAttempt: 3 }),
      },
    ]
    for (const testCase of cases) {
      testCase.mutate()
      expect(() => prepareVitestReports(options())).toThrow(testCase.message)
      rmSync(join(root, 'primary'), { recursive: true, force: true })
      rmSync(join(root, 'fallback'), { recursive: true, force: true })
    }

    bundle('primary', 'expected')
    const invalidOutput = options()
    writeFileSync(invalidOutput.outputDir, 'not a directory')
    expect(() => prepareVitestReports(invalidOutput)).toThrow('output must be a directory')
    expect(() => prepareVitestReports({ ...options(), repository: 'nope' })).toThrow(
      'Invalid Vitest repository',
    )
    expect(() =>
      prepareVitestReports({ ...options(), run: { id: '0', currentAttempt: 1 } }),
    ).toThrow('Invalid Vitest run')
    expect(() => prepareVitestReports(options(['../escape']))).toThrow('Invalid expected')
    expect(() => prepareVitestReports({ ...options(), revision: 'not-a-revision' })).toThrow(
      'Invalid Vitest revision',
    )
    expect(() =>
      prepareVitestReports({ ...options(), run: { id: identity.runId, currentAttempt: 0 } }),
    ).toThrow('Invalid Vitest run')
    expect(() => prepareVitestReports(options([identity.suite], 2, 3))).toThrow(
      'Invalid expected Vitest suite attempt',
    )
  })

  it('accepts empty existing source roots when no suites are expected', () => {
    const current = options([])
    mkdirSync(current.primaryDir, { recursive: true })
    expect(prepareVitestReports(current)).toEqual({ selected: [] })
    expect(readdirSync(current.outputDir)).toEqual([])
  })

  it('rejects symlinked source roots and report entries', () => {
    const target = join(root, 'target')
    mkdirSync(target)
    symlinkSync(target, join(root, 'primary'))
    expect(() => prepareVitestReports(options())).toThrow('primary root must be a directory')

    rmSync(join(root, 'primary'))
    const directory = bundle('primary', 'bundle')
    const report = join(directory, `${identity.suite}.json`)
    const targetReport = join(root, 'target.json')
    writeFileSync(targetReport, readFileSync(report))
    rmSync(report)
    symlinkSync(targetReport, report)
    expect(() => prepareVitestReports(options())).toThrow('exactly two files')
  })
})
