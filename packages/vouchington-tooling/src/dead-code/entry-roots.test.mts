import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveEntryRoots } from './entry-roots.mts'

let root: string

async function config(value: unknown): Promise<void> {
  await writeFile(join(root, '.jscpd.json'), JSON.stringify(value))
}

describe('resolveEntryRoots', () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dead-code-entry-test-'))
    await writeFile(join(root, 'main.mts'), '')
  })
  afterEach(() => rm(root, { recursive: true, force: true }))

  it('returns the roots configured in deadCode.entry', async () => {
    await config({ deadCode: { entry: ['main.mts', '*.mts'] } })
    expect(await resolveEntryRoots(root, '.jscpd.json')).toEqual(['main.mts', '*.mts'])
  })

  it('rejects a missing, empty, or non-array configuration', async () => {
    for (const value of [{}, { deadCode: {} }, { deadCode: { entry: 'main.mts' } }, null]) {
      await config(value)
      await expect(resolveEntryRoots(root, '.jscpd.json')).rejects.toThrow('at least one root')
    }
    await config({ deadCode: { entry: [] } })
    await expect(resolveEntryRoots(root, '.jscpd.json')).rejects.toThrow('at least one root')
    await expect(resolveEntryRoots(root, '.jscpd.json', [])).rejects.toThrow('at least one root')
  })

  it('rejects absolute, escaping, backslash, empty, and non-string roots', async () => {
    await config({ deadCode: { entry: ['main.mts'] } })
    for (const entry of ['/abs.mts', '../up.mts', 'a/../b.mts', 'a\\b.mts', '', 7]) {
      await expect(resolveEntryRoots(root, '.jscpd.json', [entry as string])).rejects.toThrow(
        'Invalid dead-code entry root',
      )
    }
  })

  it('rejects a stale root that matches no file', async () => {
    await config({ deadCode: { entry: ['gone.mts'] } })
    await expect(resolveEntryRoots(root, '.jscpd.json')).rejects.toThrow(
      'Stale dead-code entry root: gone.mts',
    )
  })

  it('writes an override into the snapshot config only', async () => {
    await config({ format: ['typescript'], deadCode: { minConfidence: 70, entry: ['gone.mts'] } })
    expect(await resolveEntryRoots(root, '.jscpd.json', ['main.mts'])).toEqual(['main.mts'])
    expect(JSON.parse(await readFile(join(root, '.jscpd.json'), 'utf8'))).toEqual({
      format: ['typescript'],
      deadCode: { minConfidence: 70, entry: ['main.mts'] },
    })
    await config({ format: ['typescript'] })
    await resolveEntryRoots(root, '.jscpd.json', ['main.mts'])
    expect(JSON.parse(await readFile(join(root, '.jscpd.json'), 'utf8'))).toEqual({
      format: ['typescript'],
      deadCode: { entry: ['main.mts'] },
    })
  })
})
