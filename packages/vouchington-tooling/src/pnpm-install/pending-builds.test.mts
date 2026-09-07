import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const writeFailure = vi.hoisted(() => ({ enabled: false }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    writeFile: (...args: Parameters<typeof actual.writeFile>) =>
      writeFailure.enabled ? Promise.reject(new Error('disk full')) : actual.writeFile(...args),
  }
})

import {
  buildLedgersAllowNativeRepair,
  deduplicatePendingBuilds,
  pendingBuilds,
  pruneStalePendingBuilds,
} from './pending-builds.mts'

const roots: string[] = []
const previousCwd = process.cwd()
const pnpm11131DuplicateLedger = join(
  import.meta.dirname,
  'fixtures',
  'pnpm-11.13.1-duplicate-pending-builds.modules.yaml',
)

afterEach(async () => {
  writeFailure.enabled = false
  process.chdir(previousCwd)
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe('pending builds', () => {
  it('classifies the live pending ledger as clear, pending, or unknown', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pending-builds-'))
    roots.push(root)
    process.chdir(root)
    expect(await pendingBuilds()).toEqual({ kind: 'unknown' })
    await mkdir(join(root, 'node_modules'))
    await writeFile(join(root, 'node_modules', '.modules.yaml'), 'pendingBuilds: []\n')
    expect(await pendingBuilds()).toEqual({ kind: 'clear' })
    await writeFile(join(root, 'node_modules', '.modules.yaml'), 'pendingBuilds: [two, one]\n')
    expect(await pendingBuilds()).toEqual({ ids: ['one', 'two'], kind: 'pending' })
    for (const contents of [
      '[]',
      'pendingBuilds:',
      'pendingBuilds: nope',
      'pendingBuilds: [one, 2]',
      '{',
    ]) {
      await writeFile(join(root, 'node_modules', '.modules.yaml'), contents)
      expect(await pendingBuilds()).toEqual({ kind: 'unknown' })
    }
  })

  it('allows isolated native repair only with clear pending and ignored ledgers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pending-build-ledgers-'))
    roots.push(root)
    await mkdir(join(root, 'node_modules'))
    process.chdir(root)
    const cases: Array<[string, boolean]> = [
      ['ignoredBuilds: []\npendingBuilds: []\n', true],
      ['ignoredBuilds: []\n', true],
      ['pendingBuilds: []\n', false],
      ['ignoredBuilds: [dependency]\npendingBuilds: []\n', false],
      ['ignoredBuilds: []\npendingBuilds: [dependency]\n', false],
      ['ignoredBuilds:\npendingBuilds: []\n', false],
      ['ignoredBuilds: []\npendingBuilds:\n', false],
      ['ignoredBuilds: nope\npendingBuilds: []\n', false],
    ]
    for (const [contents, allowed] of cases) {
      await writeFile(join(root, 'node_modules', '.modules.yaml'), contents)
      expect(await buildLedgersAllowNativeRepair()).toBe(allowed)
    }
  })

  it('deduplicates the pnpm 11.13.1 duplicate ledger without discarding distinct IDs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pending-build-deduplication-'))
    roots.push(root)
    await mkdir(join(root, 'node_modules'))
    process.chdir(root)
    const modules = join(root, 'node_modules', '.modules.yaml')
    await writeFile(modules, await readFile(pnpm11131DuplicateLedger, 'utf8'))

    await expect(deduplicatePendingBuilds()).resolves.toEqual({
      ids: ['.', 'backend'],
      kind: 'pending',
    })
    await expect(readFile(modules, 'utf8')).resolves.toContain('pendingBuilds:\n  - .\n  - backend')
  })

  it('does not rewrite an unreadable pending ledger', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pending-build-deduplication-invalid-'))
    roots.push(root)
    await mkdir(join(root, 'node_modules'))
    process.chdir(root)
    const modules = join(root, 'node_modules', '.modules.yaml')
    await writeFile(modules, 'pendingBuilds: [dependency, 2]\n')

    await expect(deduplicatePendingBuilds()).resolves.toEqual({ kind: 'unknown' })
    await expect(readFile(modules, 'utf8')).resolves.toBe('pendingBuilds: [dependency, 2]\n')
  })

  it('fails closed when it cannot rewrite duplicate pending IDs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pending-build-deduplication-write-failure-'))
    roots.push(root)
    await mkdir(join(root, 'node_modules'))
    process.chdir(root)
    const modules = join(root, 'node_modules', '.modules.yaml')
    await writeFile(modules, await readFile(pnpm11131DuplicateLedger, 'utf8'))
    writeFailure.enabled = true

    await expect(deduplicatePendingBuilds()).resolves.toEqual({ kind: 'unknown' })
    await expect(readFile(modules, 'utf8')).resolves.toContain(
      "pendingBuilds: ['.', '.', 'backend']",
    )
  })

  it('prunes only pending IDs absent from the current workspace lockfile', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pending-build-pruning-'))
    roots.push(root)
    const modulesDir = join(root, 'node_modules')
    await mkdir(modulesDir)
    process.chdir(root)
    const modules = join(modulesDir, '.modules.yaml')
    await writeFile(
      modules,
      'custom: retained\npendingBuilds: [no-mistakes@0.55.0, current@1.0.0, backend, .]\n',
    )
    await writeFile(
      join(root, 'pnpm-lock.yaml'),
      'importers:\n  .: {}\n  backend: {}\npackages:\n  current@1.0.0: {}\n',
    )

    await expect(pruneStalePendingBuilds()).resolves.toEqual({
      ids: ['.', 'backend', 'current@1.0.0'],
      kind: 'pending',
    })
    await expect(readFile(modules, 'utf8')).resolves.toContain('custom: retained')
    await expect(readFile(modules, 'utf8')).resolves.not.toContain('no-mistakes@0.55.0')
  })

  it('does not prune when the current lockfile cannot prove an ID is stale', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pending-build-pruning-invalid-lockfile-'))
    roots.push(root)
    await mkdir(join(root, 'node_modules'))
    process.chdir(root)
    const modules = join(root, 'node_modules', '.modules.yaml')
    await writeFile(modules, 'pendingBuilds: [no-mistakes@0.55.0]\n')
    await writeFile(join(root, 'pnpm-lock.yaml'), 'packages: nope\n')

    await expect(pruneStalePendingBuilds()).resolves.toEqual({ kind: 'unknown' })
    await expect(readFile(modules, 'utf8')).resolves.toContain('no-mistakes@0.55.0')
  })
})
