import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  clearPendingDependencyBuilds,
  pendingBuildDelta,
  pendingBuilds,
  validDependencyBuildIds,
} from './pending-builds.mts'

const roots: string[] = []
const previousCwd = process.cwd()

afterEach(async () => {
  process.chdir(previousCwd)
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe('pending builds', () => {
  it('reads valid pending builds and classifies exact lockfile package IDs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pending-builds-'))
    roots.push(root)
    await mkdir(join(root, 'node_modules'))
    await writeFile(join(root, 'node_modules', '.modules.yaml'), 'pendingBuilds: [one, two]\n')
    process.chdir(root)
    const known = await pendingBuilds()
    expect(known).toEqual({ kind: 'known', ids: new Set(['one', 'two']) })
    await writeFile(join(root, 'pnpm-lock.yaml'), 'packages:\n  one: {}\n  three: {}\n')
    await expect(
      pendingBuildDelta(known, { kind: 'known', ids: new Set(['one', 'three', 'workspace']) }),
    ).resolves.toEqual({ kind: 'known', dependencyIds: ['three'], workspaceIds: ['workspace'] })
    await expect(pendingBuildDelta(known, { kind: 'unknown' })).resolves.toEqual({
      kind: 'unknown',
    })
  })

  it('validates persisted IDs and atomically removes only rebuilt pending IDs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pending-build-ledger-'))
    roots.push(root)
    await mkdir(join(root, 'node_modules'))
    await writeFile(join(root, 'pnpm-lock.yaml'), 'packages:\n  dependency@1: {}\n')
    await writeFile(
      join(root, 'node_modules', '.modules.yaml'),
      'custom: retained\npendingBuilds: [dependency@1, workspace-hook]\n',
    )
    process.chdir(root)
    await expect(validDependencyBuildIds(['dependency@1'])).resolves.toEqual(['dependency@1'])
    await expect(validDependencyBuildIds(['--injected'])).resolves.toBeUndefined()
    await expect(clearPendingDependencyBuilds(['dependency@1'])).resolves.toBe(true)
    await expect(readFile(join(root, 'node_modules', '.modules.yaml'), 'utf8')).resolves.toContain(
      'pendingBuilds:\n  - workspace-hook',
    )
    await expect(clearPendingDependencyBuilds(['dependency@1'])).resolves.toBe(true)
    await writeFile(
      join(root, 'node_modules', '.modules.yaml'),
      'ignoredBuilds: [dependency@1]\npendingBuilds: [dependency@1]\n',
    )
    await expect(clearPendingDependencyBuilds(['dependency@1'])).resolves.toBe(false)
    await writeFile(join(root, 'node_modules', '.modules.yaml'), '[]\n')
    await expect(clearPendingDependencyBuilds(['dependency@1'])).resolves.toBe(false)
    await writeFile(join(root, 'node_modules', '.modules.yaml'), 'pendingBuilds: invalid\n')
    await expect(clearPendingDependencyBuilds(['dependency@1'])).resolves.toBe(false)
    await rm(join(root, 'node_modules', '.modules.yaml'))
    await expect(clearPendingDependencyBuilds(['dependency@1'])).resolves.toBe(false)
  })

  it('treats a missing field as known empty and malformed metadata as unknown', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pending-builds-invalid-'))
    roots.push(root)
    process.chdir(root)
    expect(await pendingBuilds()).toEqual({ kind: 'unknown' })
    await mkdir(join(root, 'node_modules'))
    await writeFile(join(root, 'node_modules', '.modules.yaml'), 'hoistPattern: []\n')
    expect(await pendingBuilds()).toEqual({ kind: 'known', ids: new Set() })
    for (const contents of ['[]', 'pendingBuilds: nope', 'pendingBuilds: [one, 2]', '{']) {
      await writeFile(join(root, 'node_modules', '.modules.yaml'), contents)
      expect(await pendingBuilds()).toEqual({ kind: 'unknown' })
    }
  })

  it('fails closed when lockfile package metadata cannot classify pending builds', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pending-builds-lockfile-invalid-'))
    roots.push(root)
    process.chdir(root)
    const known = { kind: 'known' as const, ids: new Set<string>() }
    const pending = { kind: 'known' as const, ids: new Set(['dependency']) }
    for (const contents of ['lockfileVersion: 9\n', 'packages: []\n', '{']) {
      await writeFile(join(root, 'pnpm-lock.yaml'), contents)
      await expect(pendingBuildDelta(known, pending)).resolves.toEqual({ kind: 'unknown' })
    }
  })
})
