import { describe, expect, it } from 'vitest'

import { diffFileName, renderDiffIndex, splitDiff } from './diff-files.mts'
import { numberDiff } from './numbered-diff.mts'

const PATCH = [
  'preamble',
  'diff --git a/a.ts b/a.ts',
  '--- a/a.ts',
  '+++ b/a.ts',
  '@@ -1,2 +1,2 @@',
  ' keep',
  '-old',
  '+new',
  'diff --git a/b.ts b/src/b.ts',
  '--- /dev/null',
  '+++ b/src/b.ts',
  '@@ -0,0 +1,2 @@',
  '+one',
  '+two',
].join('\n')

describe('splitDiff', () => {
  it('splits plain and numbered diffs per file with change counts', () => {
    for (const patch of [PATCH, numberDiff(PATCH)]) {
      const files = splitDiff(patch)
      expect(files.map(({ path, added, removed }) => ({ path, added, removed }))).toEqual([
        { path: 'a.ts', added: 1, removed: 1 },
        { path: 'src/b.ts', added: 2, removed: 0 },
      ])
      expect(files[0]?.text.startsWith('diff --git a/a.ts b/a.ts\n')).toBe(true)
      expect(files[0]?.text.endsWith('new\n')).toBe(true)
    }
    expect(splitDiff('no headers')).toEqual([])
  })

  it('names patches by position and indexes the largest change first', () => {
    expect(diffFileName(0)).toBe('0001.patch')
    expect(renderDiffIndex(splitDiff(PATCH), 'd').split('\n')).toEqual([
      '# Changed files (2)',
      '',
      '- `d/0001.patch` +1 -1 a.ts',
      '- `d/0002.patch` +2 -0 src/b.ts',
      '',
    ])
  })
})
