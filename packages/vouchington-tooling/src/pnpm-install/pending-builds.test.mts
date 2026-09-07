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
const pnpm11131StaleLedger = join(
  import.meta.dirname,
  'fixtures',
  'pnpm-11.13.1-stale-pending-builds.modules.yaml',
)

async function writeCurrentGraph(root: string) {
  await Promise.all([
    writeFile(
      join(root, 'pnpm-lock.yaml'),
      'lockfileVersion: 9\nimporters:\n  .: {}\n  backend: {}\npackages:\n  no-mistakes@0.55.0: {}\n',
    ),
    mkdir(
      join(root, 'node_modules', '.pnpm', 'no-mistakes@0.55.0', 'node_modules', 'no-mistakes'),
      {
        recursive: true,
      },
    ),
  ])
  await writeFile(
    join(
      root,
      'node_modules',
      '.pnpm',
      'no-mistakes@0.55.0',
      'node_modules',
      'no-mistakes',
      'package.json',
    ),
    '{"name":"no-mistakes","version":"0.55.0"}\n',
  )
}

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

  it('returns unknown or clear without classifying a missing or clear ledger', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pending-build-prune-early-return-'))
    roots.push(root)
    process.chdir(root)

    await expect(pruneStalePendingBuilds()).resolves.toEqual({ kind: 'unknown' })
    await mkdir(join(root, 'node_modules'))
    await writeFile(join(root, 'node_modules', '.modules.yaml'), 'pendingBuilds: []\n')
    await expect(pruneStalePendingBuilds()).resolves.toEqual({ kind: 'clear' })
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

  it('prunes only the stale pnpm 11.13.1 no-mistakes ledger ID and diagnoses it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pending-build-stale-'))
    roots.push(root)
    await mkdir(join(root, 'node_modules'))
    await writeCurrentGraph(root)
    process.chdir(root)
    const modules = join(root, 'node_modules', '.modules.yaml')
    await writeFile(modules, await readFile(pnpm11131StaleLedger, 'utf8'))
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await expect(pruneStalePendingBuilds()).resolves.toEqual({
      ids: ['no-mistakes@0.55.0'],
      kind: 'pending',
    })
    await expect(readFile(modules, 'utf8')).resolves.not.toContain('no-mistakes@0.35.0')
    expect(warning).toHaveBeenCalledWith(
      'pnpm-install: pruned stale pending build IDs absent from lockfile and package tree: no-mistakes@0.35.0',
    )
  })

  it('preserves current workspace IDs while pruning only stale IDs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pending-build-mixed-'))
    roots.push(root)
    await mkdir(join(root, 'node_modules'))
    await writeCurrentGraph(root)
    process.chdir(root)
    await writeFile(
      join(root, 'node_modules', '.modules.yaml'),
      'pendingBuilds: [backend, no-mistakes@0.35.0]\n',
    )

    await expect(pruneStalePendingBuilds()).resolves.toEqual({ ids: ['backend'], kind: 'pending' })
  })

  it('ignores malformed nested manifests that are not installed package roots', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pending-build-nested-manifest-'))
    roots.push(root)
    await mkdir(join(root, 'node_modules'))
    await writeCurrentGraph(root)
    await mkdir(
      join(
        root,
        'node_modules',
        '.pnpm',
        'no-mistakes@0.55.0',
        'node_modules',
        'no-mistakes',
        'dist',
      ),
      { recursive: true },
    )
    await Promise.all([
      writeFile(
        join(
          root,
          'node_modules',
          '.pnpm',
          'no-mistakes@0.55.0',
          'node_modules',
          'no-mistakes',
          'dist',
          'package.json',
        ),
        '{}\n',
      ),
      writeFile(
        join(root, 'node_modules', '.modules.yaml'),
        'pendingBuilds: [no-mistakes@0.35.0, no-mistakes@0.55.0]\n',
      ),
    ])
    process.chdir(root)

    await expect(pruneStalePendingBuilds()).resolves.toEqual({
      ids: ['no-mistakes@0.55.0'],
      kind: 'pending',
    })
  })

  it('preserves peer-qualified scoped IDs represented by package and snapshot graph entries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pending-build-peer-qualified-'))
    roots.push(root)
    await mkdir(
      join(
        root,
        'node_modules',
        '.pnpm',
        '@scope+native@1.0.0_peer@2.0.0',
        'node_modules',
        '@scope',
        'native',
      ),
      { recursive: true },
    )
    await Promise.all([
      writeFile(
        join(root, 'pnpm-lock.yaml'),
        'lockfileVersion: 9\nimporters: {}\npackages:\n  "@scope/native@1.0.0": {}\nsnapshots:\n  "@scope/native@1.0.0(peer@2.0.0)": {}\n',
      ),
      writeFile(
        join(root, 'node_modules', '.modules.yaml'),
        'pendingBuilds: ["@scope/native@1.0.0(peer@2.0.0)"]\n',
      ),
      writeFile(
        join(
          root,
          'node_modules',
          '.pnpm',
          '@scope+native@1.0.0_peer@2.0.0',
          'node_modules',
          '@scope',
          'native',
          'package.json',
        ),
        '{"name":"@scope/native","version":"1.0.0"}\n',
      ),
    ])
    process.chdir(root)

    await expect(pruneStalePendingBuilds()).resolves.toEqual({
      ids: ['@scope/native@1.0.0(peer@2.0.0)'],
      kind: 'pending',
    })
  })

  it('fails closed without rewriting when graph classification is uncertain', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pending-build-classification-unknown-'))
    roots.push(root)
    await mkdir(join(root, 'node_modules'))
    process.chdir(root)
    const modules = join(root, 'node_modules', '.modules.yaml')
    await writeFile(modules, 'pendingBuilds: [no-mistakes@0.35.0]\n')

    await expect(pruneStalePendingBuilds()).resolves.toEqual({ kind: 'unknown' })
    await expect(readFile(modules, 'utf8')).resolves.toBe('pendingBuilds: [no-mistakes@0.35.0]\n')
  })

  it.each([
    'lockfileVersion: 9\nimporters: {}\n',
    'lockfileVersion: 9\nimporters: {}\npackages: {}\nsnapshots: nope\n',
    '[]\n',
  ])('fails closed for malformed lockfile graph structures: %j', async (lockfile) => {
    const root = await mkdtemp(join(tmpdir(), 'pending-build-lockfile-unknown-'))
    roots.push(root)
    await mkdir(join(root, 'node_modules'))
    await Promise.all([
      writeFile(join(root, 'pnpm-lock.yaml'), lockfile),
      writeFile(join(root, 'node_modules', '.modules.yaml'), 'pendingBuilds: [stale]\n'),
    ])
    process.chdir(root)

    await expect(pruneStalePendingBuilds()).resolves.toEqual({ kind: 'unknown' })
  })

  it('scans only direct installed package roots in pnpm virtual and scoped trees', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pending-build-package-roots-'))
    roots.push(root)
    const virtual = join(root, 'node_modules', '.pnpm', 'virtual@1.0.0', 'node_modules', 'virtual')
    const scoped = join(root, 'node_modules', '@scope', 'installed')
    await Promise.all([
      mkdir(join(root, 'node_modules', '.pnpm', 'node_modules'), { recursive: true }),
      mkdir(virtual, { recursive: true }),
      mkdir(join(root, 'node_modules', '.pnpm', 'virtual@1.0.0', 'node_modules', '.bin'), {
        recursive: true,
      }),
      mkdir(scoped, { recursive: true }),
      mkdir(join(root, 'node_modules', '.cache'), { recursive: true }),
    ])
    await Promise.all([
      writeFile(
        join(root, 'pnpm-lock.yaml'),
        'lockfileVersion: 9\nimporters: {}\npackages:\n  virtual@1.0.0: {}\n  "@scope/installed@1.0.0": {}\n',
      ),
      writeFile(
        join(root, 'node_modules', '.modules.yaml'),
        'pendingBuilds: [virtual@1.0.0, "@scope/installed@1.0.0"]\n',
      ),
      writeFile(join(virtual, 'package.json'), '{"name":"virtual","version":"1.0.0"}\n'),
      writeFile(join(scoped, 'package.json'), '{"name":"@scope/installed","version":"1.0.0"}\n'),
    ])
    process.chdir(root)

    await expect(pruneStalePendingBuilds()).resolves.toEqual({
      ids: ['@scope/installed@1.0.0', 'virtual@1.0.0'],
      kind: 'pending',
    })
  })

  it('fails closed without rewriting when the package tree cannot be classified', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pending-build-package-tree-unknown-'))
    roots.push(root)
    await mkdir(join(root, 'node_modules', 'broken-package'), { recursive: true })
    await writeFile(
      join(root, 'pnpm-lock.yaml'),
      'lockfileVersion: 9\nimporters: {}\npackages: {}\n',
    )
    process.chdir(root)
    const modules = join(root, 'node_modules', '.modules.yaml')
    await Promise.all([
      writeFile(modules, 'pendingBuilds: [no-mistakes@0.35.0]\n'),
      writeFile(join(root, 'node_modules', 'broken-package', 'package.json'), '{}\n'),
    ])

    await expect(pruneStalePendingBuilds()).resolves.toEqual({ kind: 'unknown' })
    await expect(readFile(modules, 'utf8')).resolves.toBe('pendingBuilds: [no-mistakes@0.35.0]\n')
  })

  it('fails closed when it cannot rewrite stale pending IDs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pending-build-stale-write-failure-'))
    roots.push(root)
    await mkdir(join(root, 'node_modules'))
    await writeCurrentGraph(root)
    process.chdir(root)
    const modules = join(root, 'node_modules', '.modules.yaml')
    await writeFile(modules, 'pendingBuilds: [no-mistakes@0.35.0]\n')
    writeFailure.enabled = true

    await expect(pruneStalePendingBuilds()).resolves.toEqual({ kind: 'unknown' })
    await expect(readFile(modules, 'utf8')).resolves.toBe('pendingBuilds: [no-mistakes@0.35.0]\n')
  })
})
