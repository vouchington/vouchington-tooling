import { execFileSync } from 'node:child_process'
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFixtureDeadline } from './fixture-deadline.test-helpers.mts'
import { createFindingFilter, scanDeadCode } from './scan.mts'
import { copyTrackedWorkingTree } from './tracked-snapshot.mts'

const jscpd = resolve(import.meta.dirname, '../../../../node_modules/.bin/jscpd')

const identity = {
  category: 'unused-symbol',
  path: 'src/example.mts',
  parent: '',
  name: 'unused',
  symbolKind: 'function',
}

describe('createFindingFilter', () => {
  it('drops test files, test-only files, and excluded globs', () => {
    const keep = createFindingFilter(['skip/**'])
    expect(keep(identity, {})).toBe(true)
    expect(keep({ ...identity, path: 'src/a.test.mts' }, {})).toBe(false)
    expect(keep({ ...identity, path: 'src/a.spec.ts' }, {})).toBe(false)
    expect(keep({ ...identity, path: 'skip/a.mts' }, {})).toBe(false)
    const file = { ...identity, category: 'unused-file' }
    expect(keep(file, { reasons: ['used-only-by-tests'] })).toBe(false)
    expect(keep(file, { reasons: ['other'] })).toBe(true)
    expect(keep(file, {})).toBe(true)
    expect(createFindingFilter()({ ...identity, path: 'skip/a.mts' }, {})).toBe(true)
  })
})

describe('released jscpd dead-code invocation', () => {
  it('reports a tracked orphan even when an untracked importer and gitignore mask it', async () => {
    const remaining = createFixtureDeadline()
    const directory = await mkdtemp(join(tmpdir(), 'dead-code-native-test-'))
    const repo = join(directory, 'repo')
    const snapshot = join(directory, 'snapshot')
    try {
      await mkdir(repo)
      execFileSync('git', ['init', '-q'], {
        cwd: repo,
        timeout: remaining(),
        killSignal: 'SIGKILL',
      })
      await writeFile(join(repo, 'main.mts'), 'export const live = 1\n')
      await writeFile(join(repo, 'orphan.mts'), 'export const orphan = 2\n')
      await writeFile(join(repo, 'test-only.mts'), 'export const helper = 3\n')
      await writeFile(join(repo, 'main.test.mts'), "import './test-only.mts'\n")
      await mkdir(join(repo, 'skip'))
      await writeFile(join(repo, 'skip', 'mock.mts'), 'export const mock = 5\n')
      await writeFile(
        join(repo, 'custom.json'),
        JSON.stringify({
          format: ['typescript'],
          deadCode: { categories: ['unused-file'], minConfidence: 70, entry: ['main.mts'] },
        }),
      )
      execFileSync('git', ['add', '.'], { cwd: repo, timeout: remaining(), killSignal: 'SIGKILL' })
      await writeFile(join(repo, 'importer.mts'), "import './orphan.mts'\n")
      await writeFile(join(repo, '.gitignore'), 'orphan.mts\n')
      await copyTrackedWorkingTree(repo, snapshot, remaining)
      const reportRoot = join(directory, 'report')
      const rows = await scanDeadCode(snapshot, reportRoot, jscpd, remaining, {
        configPath: 'custom.json',
        excludeGlobs: ['skip/**'],
      })
      const report = JSON.parse(await readFile(join(reportRoot, 'basta-report.json'), 'utf8')) as {
        findings: { path: string; reasons?: string[] }[]
      }
      expect(report.findings).toContainEqual(
        expect.objectContaining({ path: 'test-only.mts', reasons: ['used-only-by-tests'] }),
      )
      expect(report.findings).toContainEqual(expect.objectContaining({ path: 'skip/mock.mts' }))
      expect(rows).toContainEqual({
        ...identity,
        category: 'unused-file',
        path: 'orphan.mts',
        name: '',
        symbolKind: '',
        count: 1,
      })
      expect(rows.map((row) => row.path)).not.toContain('test-only.mts')
      expect(rows.map((row) => row.path)).not.toContain('skip/mock.mts')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('fails when the analyzer exits unsuccessfully or omits its JSON report', async () => {
    const remaining = createFixtureDeadline()
    const directory = await mkdtemp(join(tmpdir(), 'dead-code-process-test-'))
    try {
      const failing = join(directory, 'fail.sh')
      const silent = join(directory, 'silent.sh')
      await writeFile(failing, '#!/bin/sh\nexit 7\n')
      await writeFile(silent, '#!/bin/sh\nexit 0\n')
      await chmod(failing, 0o755)
      await chmod(silent, 0o755)
      await expect(
        scanDeadCode(directory, join(directory, 'failed'), failing, remaining),
      ).rejects.toThrow('Command failed')
      await expect(
        scanDeadCode(directory, join(directory, 'silent'), silent, remaining),
      ).rejects.toThrow('ENOENT')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
