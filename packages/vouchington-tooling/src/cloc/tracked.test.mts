import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fakeScc, layoutConfig, tempRepo } from './layout.test-helpers.mts'
import { countFiles } from './count.mts'
import { listTrackedFiles } from './tracked.mts'

describe('listTrackedFiles', () => {
  it('lists tracked paths, including names that span read chunks', async () => {
    const long = `deep/${'x'.repeat(200)}.ts`
    const files: Record<string, string> = { 'a.ts': 'a', [long]: 'b', 'dir/b.ts': 'c' }
    for (let index = 0; index < 400; index += 1) files[`bulk/${'y'.repeat(180)}-${index}.ts`] = 'z'
    const listed = await listTrackedFiles(tempRepo(files))
    expect(listed.size).toBe(403)
    expect(listed.has('a.ts')).toBe(true)
    expect(listed.has(long)).toBe(true)
    expect(listed.has('dir/b.ts')).toBe(true)
  })

  it('fails outside a git repository', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cloc-nogit-'))
    await expect(listTrackedFiles(dir)).rejects.toThrow('git ls-files exited with status')
  })
})

describe('countFiles with no existing targets', () => {
  it('returns nothing without running scc', async () => {
    const repo = tempRepo({ 'elsewhere/x.ts': 'x' })
    const scc = fakeScc('not csv', 9)
    await expect(countFiles(layoutConfig(), { cwd: repo, sccBin: scc })).resolves.toEqual([])
  })
})
