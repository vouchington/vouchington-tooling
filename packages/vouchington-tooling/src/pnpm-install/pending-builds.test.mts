import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { hasNewPendingBuilds, pendingBuilds } from './pending-builds.mts'

const roots: string[] = []
const previousCwd = process.cwd()

afterEach(async () => {
  process.chdir(previousCwd)
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe('pending builds', () => {
  it('reads valid pending builds and treats unknown/new state conservatively', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pending-builds-'))
    roots.push(root)
    await mkdir(join(root, 'node_modules'))
    await writeFile(join(root, 'node_modules', '.modules.yaml'), 'pendingBuilds: [one, two]\n')
    process.chdir(root)
    const known = await pendingBuilds()
    expect(known).toEqual({ kind: 'known', ids: new Set(['one', 'two']) })
    expect(hasNewPendingBuilds(known, { kind: 'known', ids: new Set(['one', 'two']) })).toBe(false)
    expect(hasNewPendingBuilds(known, { kind: 'known', ids: new Set(['one', 'three']) })).toBe(true)
    expect(hasNewPendingBuilds(known, { kind: 'unknown' })).toBe(true)
    expect(hasNewPendingBuilds({ kind: 'unknown' }, known)).toBe(true)
  })

  it('returns unknown for missing and malformed pending-build metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pending-builds-invalid-'))
    roots.push(root)
    process.chdir(root)
    expect(await pendingBuilds()).toEqual({ kind: 'unknown' })
    await mkdir(join(root, 'node_modules'))
    for (const contents of ['[]', 'pendingBuilds: nope', 'pendingBuilds: [one, 2]', '{']) {
      await writeFile(join(root, 'node_modules', '.modules.yaml'), contents)
      expect(await pendingBuilds()).toEqual({ kind: 'unknown' })
    }
  })
})
