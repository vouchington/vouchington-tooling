import { describe, expect, it } from 'vitest'

import { NUMBERED_DIFF_LEGEND, numberDiff } from './numbered-diff.mts'

const patch = [
  'diff --git a/a.ts b/a.ts',
  'index 1..2 100644',
  '--- a/a.ts',
  '+++ b/a.ts',
  '@@ -10,3 +40,3 @@ function x() {',
  ' keep',
  '-old',
  '+new',
  '\\ No newline at end of file',
  'diff --git a/b.ts b/b.ts',
  '--- /dev/null',
  '+++ b/b.ts',
  '@@ -0,0 +1 @@',
  '+only',
  '',
].join('\n')

describe('numberDiff', () => {
  it('prefixes hunk lines with base and head line numbers', () => {
    expect(numberDiff(patch).split('\n')).toEqual([
      'diff --git a/a.ts b/a.ts',
      'index 1..2 100644',
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -10,3 +40,3 @@ function x() {',
      '    10     40  keep',
      '    11        -old',
      '           41 +new',
      '\\ No newline at end of file',
      'diff --git a/b.ts b/b.ts',
      '--- /dev/null',
      '+++ b/b.ts',
      '@@ -0,0 +1 @@',
      '            1 +only',
      '',
    ])
  })

  it('numbers empty context lines from diff.suppressBlankEmpty and stops at the hunk length', () => {
    const blank = [
      '@@ -1,3 +1,3 @@',
      ' a',
      '',
      '-b',
      '+c',
      '',
      '-- ',
      'sig',
      '@@ -9 +9 @@',
      '-x',
      '+y',
    ].join('\n')
    expect(numberDiff(blank).split('\n')).toEqual([
      '@@ -1,3 +1,3 @@',
      '     1      1  a',
      '     2      2 ',
      '     3        -b',
      '            3 +c',
      '',
      '-- ',
      'sig',
      '@@ -9 +9 @@',
      '     9        -x',
      '            9 +y',
    ])
  })

  it('explains the format', () => {
    expect(NUMBERED_DIFF_LEGEND).toContain('RIGHT')
  })
})
