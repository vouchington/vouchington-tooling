import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  createVitestReportAttempt,
  parseVitestReportAttempt,
  readVitestReportAttempts,
  serializeVitestReportAttempt,
  VITEST_REPORT_ATTEMPT_PREFIX,
  writeVitestReportAttempt,
} from './index.mts'

const identity = {
  repository: 'owner/repo',
  revision: 'a'.repeat(40),
  runId: '9131',
  attempt: 2,
} as const

describe('Vitest report attempts', () => {
  const roots: string[] = []

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  function root(): string {
    const directory = mkdtempSync(join(tmpdir(), 'vitest-attempt-'))
    roots.push(directory)
    return directory
  }

  function artifact(parent: string, suite: string, attempt: number): string {
    const directory = join(parent, `${VITEST_REPORT_ATTEMPT_PREFIX}${suite}`)
    writeVitestReportAttempt(directory, suite, { ...identity, attempt })
    return directory
  }

  it('creates deterministic strict markers and reads sorted exact artifacts', () => {
    const marker = createVitestReportAttempt('tooling', identity)
    expect(parseVitestReportAttempt(marker)).toEqual(marker)
    expect(serializeVitestReportAttempt(marker)).toEqual(
      Buffer.from(`${JSON.stringify(marker, null, 2)}\n`),
    )

    const directory = root()
    artifact(directory, 'tooling', 1)
    artifact(directory, 'backend-shard-1', 2)
    expect(readVitestReportAttempts(directory, identity)).toEqual({
      'backend-shard-1': 2,
      tooling: 1,
    })
  })

  it('supports the exact flattened artifact layout and atomically replaces a marker', () => {
    const directory = root()
    const path = writeVitestReportAttempt(directory, 'tooling', { ...identity, attempt: 1 })
    writeVitestReportAttempt(directory, 'tooling', identity)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ run: { attempt: 2 } })
    expect(readVitestReportAttempts(directory, identity)).toEqual({ tooling: 2 })
  })

  it('rejects schema violations, foreign/future markers, and every unowned layout', () => {
    const marker = createVitestReportAttempt('tooling', identity)
    for (const raw of [
      { ...marker, extra: true },
      { ...marker, suite: '../tooling' },
      { ...marker, run: { ...marker.run, attempt: 0 } },
    ]) {
      expect(() => parseVitestReportAttempt(raw)).toThrow('invalid schema')
    }
    expect(() => createVitestReportAttempt('../../outside', identity)).toThrow('invalid schema')
    expect(() => createVitestReportAttempt('tooling', { ...identity, runId: '0' })).toThrow(
      'identity has an invalid schema',
    )

    const cases: Array<(directory: string) => void> = [
      (directory) => writeFileSync(join(directory, 'unexpected'), ''),
      (directory) => artifact(directory, 'tooling', 3),
      (directory) =>
        writeVitestReportAttempt(
          join(directory, `${VITEST_REPORT_ATTEMPT_PREFIX}tooling`),
          'tooling',
          {
            ...identity,
            repository: 'other/repo',
          },
        ),
      (directory) => {
        const artifactDirectory = artifact(directory, 'tooling', 1)
        writeFileSync(join(artifactDirectory, 'extra'), '')
      },
    ]
    for (const mutate of cases) {
      const directory = root()
      mutate(directory)
      expect(() => readVitestReportAttempts(directory, identity)).toThrow(
        /marker|artifact|root|identity/,
      )
    }
  })

  it('rejects symlinked roots, artifacts, and marker files', () => {
    const directory = root()
    const target = join(root(), 'target')
    mkdirSync(target)
    symlinkSync(target, join(directory, 'linked'))
    expect(() => readVitestReportAttempts(join(directory, 'linked'), identity)).toThrow(
      'root must be a directory',
    )

    const artifactDirectory = artifact(directory, 'tooling', 1)
    const marker = join(artifactDirectory, 'tooling.json')
    const markerTarget = join(root(), 'marker.json')
    writeFileSync(markerTarget, readFileSync(marker))
    rmSync(marker)
    symlinkSync(markerTarget, marker)
    expect(() => readVitestReportAttempts(directory, identity)).toThrow('unexpected entry')
  })

  it('rejects missing roots, invalid flattened names, and invalid artifact suite names', () => {
    expect(readVitestReportAttempts(join(root(), 'missing'), identity)).toEqual({})

    const flattened = root()
    writeFileSync(join(flattened, 'not-a-suite.json'), '{}')
    expect(() => readVitestReportAttempts(flattened, identity)).toThrow('invalid schema')

    const invalidArtifact = root()
    mkdirSync(join(invalidArtifact, `${VITEST_REPORT_ATTEMPT_PREFIX}../escape`), {
      recursive: true,
    })
    expect(() => readVitestReportAttempts(invalidArtifact, identity)).toThrow(
      'Invalid Vitest suite attempt artifact',
    )
  })
})
