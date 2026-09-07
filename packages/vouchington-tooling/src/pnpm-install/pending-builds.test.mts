import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { buildLedgersAllowNativeRepair, pendingBuilds } from './pending-builds.mts'

const roots: string[] = []
const previousCwd = process.cwd()

afterEach(async () => {
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
})
