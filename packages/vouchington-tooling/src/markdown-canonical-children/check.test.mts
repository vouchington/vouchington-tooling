import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { buildContextFromTrackedFiles } from '../shared-context/index.mts'
import { checkCanonicalChildLinks } from './check.mts'

const PARENT = 'docs/split/parent.md'
const FRAGMENT_ONLY =
  '- <a id="overview-mechanics"></a>[Overview mechanics](reference-overview.md#mechanics)'

describe('checkCanonicalChildLinks', () => {
  const testDirs: string[] = []

  afterEach(() => {
    for (const dir of testDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
  })

  function makeRoot(files: Record<string, string>): string {
    const repoRoot = mkdtempSync(join(tmpdir(), 'canonical-child-links-'))
    testDirs.push(repoRoot)
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(repoRoot, path)), { recursive: true })
      writeFileSync(join(repoRoot, path), content)
    }
    return repoRoot
  }

  function check(files: Record<string, string>): string[] {
    const ctx = buildContextFromTrackedFiles(makeRoot(files), Object.keys(files))
    return checkCanonicalChildLinks(ctx, { parents: [PARENT] }).errors
  }

  it('rejects a fragment-only canonical child in a listed parent', () => {
    expect(check({ [PARENT]: FRAGMENT_ONLY })).toEqual([
      expect.stringContaining(
        'canonical child reference-overview.md is linked only by a fragment; add a whole-file Markdown link for composition',
      ),
    ])
  })

  it('allows normalized whole-file and fragment targets in a listed parent', () => {
    const content = `- <a id="overview"></a>[Overview](./reference-overview.md)\n${FRAGMENT_ONLY}`

    expect(check({ [PARENT]: content })).toEqual([])
  })

  it('does not apply the contract to Markdown files outside the parents option', () => {
    expect(check({ 'docs/other.md': FRAGMENT_ONLY })).toEqual([])
  })

  it('skips a listed parent that is not tracked', () => {
    expect(check({})).toEqual([])
  })

  it('reads a parent from disk when the context has no cached reader', () => {
    const repoRoot = makeRoot({ [PARENT]: FRAGMENT_ONLY })
    const ctx = buildContextFromTrackedFiles(repoRoot, [PARENT])
    delete ctx.readTrackedFile

    expect(checkCanonicalChildLinks(ctx, { parents: [PARENT] }).errors).toHaveLength(1)
  })
})
