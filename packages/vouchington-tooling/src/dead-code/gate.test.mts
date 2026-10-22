import { readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runDeadCodeGate } from './gate.mts'
import { analyzer, fixture, orphan, type Fixture } from './gate.test-helpers.mts'

let current: Fixture | undefined

async function setup(findings?: unknown[]): Promise<Fixture> {
  current = await fixture(findings)
  return current
}

afterEach(async () => {
  if (current) await rm(dirname(current.repo), { recursive: true, force: true })
  current = undefined
})

function options(f: Fixture) {
  return { repoRoot: f.repo, baselinePath: 'baseline.json', binary: f.binary }
}

describe('runDeadCodeGate', () => {
  it('seeds, checks, and shrinks the baseline', async () => {
    const f = await setup()
    expect(await runDeadCodeGate({ ...options(f), operation: 'seed' })).toEqual({
      operation: 'seed',
      identities: 1,
      trackedFiles: 3,
      removed: 0,
    })
    expect(JSON.parse(await readFile(f.baseline, 'utf8')).findings).toHaveLength(1)
    expect(await runDeadCodeGate(options(f))).toMatchObject({ operation: 'check', identities: 1 })

    const clean = await analyzer(dirname(f.repo), [])
    await expect(runDeadCodeGate({ ...options(f), binary: clean })).rejects.toThrow(
      'Stale dead-code baseline',
    )
    expect(
      await runDeadCodeGate({ ...options(f), binary: clean, operation: 'update' }),
    ).toMatchObject({ identities: 0, removed: 1 })
    expect(JSON.parse(await readFile(f.baseline, 'utf8')).findings).toEqual([])
  })

  it('refuses new findings and leaves the baseline untouched', async () => {
    const f = await setup([])
    await runDeadCodeGate({ ...options(f), operation: 'seed' })
    const before = await readFile(f.baseline, 'utf8')
    const noisy = await analyzer(dirname(f.repo), [orphan])
    await expect(runDeadCodeGate({ ...options(f), binary: noisy })).rejects.toThrow(
      'New dead-code findings',
    )
    expect(await readFile(f.baseline, 'utf8')).toBe(before)
  })

  it('requires an existing baseline except for the first seed', async () => {
    const f = await setup()
    await expect(runDeadCodeGate(options(f))).rejects.toThrow('baseline is missing')
    await expect(runDeadCodeGate({ ...options(f), operation: 'update' })).rejects.toThrow(
      'baseline is missing',
    )
    await writeFile(f.baseline, '{}')
    await expect(runDeadCodeGate({ ...options(f), operation: 'seed' })).rejects.toThrow(
      'cannot replace it',
    )
  })

  it('applies entry roots, snapshot ignores, config path, and finding exclusions', async () => {
    const f = await setup([{ ...orphan, path: 'skip/x.mts' }])
    expect(
      await runDeadCodeGate({
        ...options(f),
        operation: 'seed',
        entryRoots: ['orphan.mts'],
        snapshotIgnore: ['main.mts'],
        excludeFindings: ['skip/**'],
      }),
    ).toMatchObject({ identities: 0, trackedFiles: 2 })
  })

  it('passes override roots to the analyzer through the snapshot config', async () => {
    const f = await setup()
    const seen = join(dirname(f.repo), 'seen.json')
    const spy = join(dirname(f.repo), 'spy.mjs')
    await writeFile(
      spy,
      `#!/usr/bin/env node
import { copyFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
copyFileSync(process.argv[process.argv.indexOf('--config') + 1], ${JSON.stringify(seen)})
execFileSync(${JSON.stringify(f.binary)}, process.argv.slice(2))
`,
      { mode: 0o755 },
    )
    await runDeadCodeGate({
      ...options(f),
      binary: spy,
      operation: 'seed',
      entryRoots: ['orphan.mts'],
    })
    expect(JSON.parse(await readFile(seen, 'utf8')).deadCode.entry).toEqual(['orphan.mts'])
    expect(JSON.parse(await readFile(join(f.repo, '.jscpd.json'), 'utf8')).deadCode.entry).toEqual([
      'main.mts',
    ])
  })

  it('defaults the binary to node_modules/.bin/jscpd and removes its temp directory', async () => {
    const f = await setup()
    const before = (await readdir(tmpdir())).filter((name) => name.startsWith('dead-code-gate-'))
    await expect(
      runDeadCodeGate({ repoRoot: f.repo, baselinePath: f.baseline, operation: 'seed' }),
    ).rejects.toThrow()
    const after = (await readdir(tmpdir())).filter((name) => name.startsWith('dead-code-gate-'))
    expect(after.length).toBeLessThanOrEqual(before.length)
  })
})
