import { describe, expect, it } from 'vitest'

import { indexReviewFiles, parsePatchCommentable, parseReviewFilesJson } from './diff.mts'
import { nearestReviewLine, remapReviewComments, snapReviewNote } from './remap.mts'
import { reviewCommentSubject } from './payload.mts'
import type { ReviewComment, SanitizedReview } from './payload.mts'

function contextPatch(start: number, count: number): string {
  return `@@ -${start},${count} +${start},${count} @@\n${Array.from({ length: count }, () => ' unchanged').join('\n')}\n`
}

function comment(
  overrides: Partial<ReviewComment> & Pick<ReviewComment, 'path' | 'line'>,
): ReviewComment {
  return { side: 'RIGHT', body: `Finding at ${overrides.path}:${overrides.line}`, ...overrides }
}

function review(comments: ReviewComment[], body = 'Verdict.'): SanitizedReview {
  return { event: 'COMMENT', commit_id: 'head', body, comments }
}

describe('diff indexing', () => {
  it('indexes both sides, skips marker lines, and handles paginated JSON', () => {
    const patch = [
      '@@ -10,4 +10,5 @@',
      ' context-a',
      '-removed',
      '+added',
      ' context-b',
      '\\ No newline at end of file',
    ].join('\n')
    expect(parsePatchCommentable('src/a.mts', patch)).toEqual([
      { path: 'src/a.mts', side: 'LEFT', line: 10, kind: 'context' },
      { path: 'src/a.mts', side: 'RIGHT', line: 10, kind: 'context' },
      { path: 'src/a.mts', side: 'LEFT', line: 11, kind: 'del' },
      { path: 'src/a.mts', side: 'RIGHT', line: 11, kind: 'add' },
      { path: 'src/a.mts', side: 'LEFT', line: 12, kind: 'context' },
      { path: 'src/a.mts', side: 'RIGHT', line: 12, kind: 'context' },
    ])
    expect(
      parseReviewFilesJson(
        '[{"filename":"a.mts","patch":"@@ -1 +1 @@\\n+ok\\n"}][{"filename":"b.bin"}]',
      ),
    ).toEqual([{ filename: 'a.mts', patch: '@@ -1 +1 @@\n+ok\n' }, { filename: 'b.bin' }])
  })

  it('drops malformed file entries, preserves metadata, and handles invalid pages', () => {
    expect(
      parseReviewFilesJson(
        JSON.stringify([
          null,
          42,
          {},
          { filename: '', previous_filename: 'ignored' },
          { filename: 'renamed.mts', previous_filename: 'old.mts', patch: '', status: 'renamed' },
        ]),
      ),
    ).toEqual([
      { filename: 'renamed.mts', previous_filename: 'old.mts', patch: '', status: 'renamed' },
    ])
    expect(parseReviewFilesJson('   ')).toEqual([])
    expect(parseReviewFilesJson('{not json}')).toEqual([])
    expect(parseReviewFilesJson('{"filename":"single.mts"}')).toEqual([{ filename: 'single.mts' }])
  })

  it('exposes indexed kinds and aliases', () => {
    const index = indexReviewFiles([
      {
        filename: 'new.mts',
        previous_filename: 'old.mts',
        patch: '@@ -2,1 +2,1 @@\n-old\n+new\n',
      },
    ])
    expect(index.resolvePath('old.mts')).toBe('new.mts')
    expect(index.kind('new.mts', 'LEFT', 2)).toBe('del')
    expect(index.kind('new.mts', 'RIGHT', 2)).toBe('add')
    expect(index.kind('new.mts', 'RIGHT', 3)).toBeUndefined()
    expect(index.candidates('missing.mts', 'RIGHT')).toEqual([])
    expect(indexReviewFiles([{ filename: 'empty.mts', patch: '' }]).hasPatch('empty.mts')).toBe(
      false,
    )
  })

  it('handles a parser-shaped subject with no first line', () => {
    const unusual = {
      path: 'src/unusual.mts',
      line: 1,
      body: { split: () => [] },
    } as unknown as ReviewComment
    expect(reviewCommentSubject(unusual)).toBe('src/unusual.mts:1 - ')
  })
})

describe('remapReviewComments', () => {
  it('remaps renames, strips invalid ranges, and snaps nearest lines', () => {
    const index = indexReviewFiles([
      { filename: 'src/new.mts', previous_filename: 'src/old.mts', patch: contextPatch(1, 10) },
    ])
    const remapped = remapReviewComments(
      review([
        comment({ path: 'src/old.mts', line: 2 }),
        comment({ path: 'src/new.mts', line: 5, start_line: 99, start_side: 'RIGHT' }),
        comment({ path: 'src/new.mts', line: 6, start_line: 1 }),
        comment({ path: 'src/new.mts', line: 50, start_line: 1, start_side: 'RIGHT' }),
      ]),
      index,
    )
    expect(remapped.comments[0]?.path).toBe('src/new.mts')
    expect(remapped.comments[1]?.start_line).toBeUndefined()
    expect(remapped.comments[2]?.start_line).toBeUndefined()
    expect(remapped.comments[3]?.start_line).toBeUndefined()
    expect(remapped.comments).toHaveLength(4)
    expect(remapped.body).toBe('Verdict.')
    expect(
      nearestReviewLine(
        [
          { line: 4, kind: 'context' },
          { line: 6, kind: 'add' },
        ],
        5,
      ),
    ).toEqual({ line: 6, kind: 'add' })
  })

  it('moves LEFT comments to RIGHT on added-only files and removes suggestion fences when snapping', () => {
    const remapped = remapReviewComments(
      review([
        comment({ path: 'src/new.mts', line: 1, side: 'LEFT', body: '```suggestion\nnew\n```' }),
        comment({ path: 'src/new.mts', line: 50, side: 'LEFT', body: 'far away' }),
      ]),
      indexReviewFiles([{ filename: 'src/new.mts', patch: '@@ -0,0 +1,2 @@\n+one\n+two\n' }]),
    )
    expect(remapped.comments[0]?.side).toBe('RIGHT')
    expect(remapped.comments[0]?.body).not.toContain('```suggestion')
    expect(remapped.comments[1]?.line).toBe(2)
    expect(remapped.comments[1]?.body).toContain(snapReviewNote('src/new.mts', 50))
  })

  it('breaks equal-distance ties toward changed lines and rejects unplaceable comments', () => {
    expect(
      nearestReviewLine(
        [
          { line: 4, kind: 'context' },
          { line: 6, kind: 'context' },
        ],
        5,
      ),
    ).toEqual({ line: 6, kind: 'context' })
    expect(
      nearestReviewLine(
        [
          { line: 4, kind: 'add' },
          { line: 10, kind: 'context' },
        ],
        5,
      ),
    ).toEqual({ line: 4, kind: 'add' })
    expect(
      nearestReviewLine(
        [
          { line: 4, kind: 'add' },
          { line: 6, kind: 'context' },
        ],
        5,
      ),
    ).toEqual({ line: 4, kind: 'add' })
    expect(
      nearestReviewLine(
        [
          { line: 6, kind: 'context' },
          { line: 4, kind: 'context' },
        ],
        5,
      ),
    ).toEqual({ line: 6, kind: 'context' })
    expect(() =>
      remapReviewComments(
        review([comment({ path: 'src/empty.mts', line: 9 })]),
        indexReviewFiles([{ filename: 'src/empty.mts', patch: '@@ -1,0 +1,0 @@\n' }]),
      ),
    ).toThrow('Inline finding cannot be placed')
    expect(() =>
      remapReviewComments(
        review([comment({ path: 'src/missing.mts', line: 9 })]),
        indexReviewFiles([{ filename: 'src/other.mts', patch: '@@ -0,0 +1 @@\n+one\n' }]),
      ),
    ).toThrow('Inline finding cannot be placed')
    const snapped = remapReviewComments(
      review([comment({ path: 'src/add.mts', line: 50, side: 'RIGHT' })]),
      indexReviewFiles([{ filename: 'src/add.mts', patch: '@@ -0,0 +1,2 @@\n+one\n+two\n' }]),
    )
    expect(snapped.comments[0]?.line).toBe(2)
    expect(
      remapReviewComments(
        review([comment({ path: 'src/add.mts', line: 1, side: 'RIGHT' })], ''),
        indexReviewFiles([{ filename: 'src/add.mts', patch: '@@ -0,0 +1 @@\n+one\n' }]),
      ).body,
    ).toBe('Inline findings only.')
  })
})
