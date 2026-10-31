import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

import { assertPullTarget, createGhFinalReviewIo } from './github.mts'

const target = { repo: 'acme/widgets', pr: 7 }

function setup(responses: string[] = []) {
  const calls: string[][] = []
  const run = vi.fn(async (args: string[]) => {
    calls.push(args)
    return responses.shift() ?? ''
  })
  return { calls, run, io: createGhFinalReviewIo(target, run) }
}

const review = { event: 'COMMENT' as const, commit_id: 'x', body: 'b', comments: [] }

describe('assertPullTarget', () => {
  it('validates repo and pr', () => {
    expect(() => assertPullTarget(target)).not.toThrow()
    expect(() => assertPullTarget({ repo: 'nope', pr: 1 })).toThrow('--repo must be owner/name.')
    expect(() => assertPullTarget({ repo: 'a/b', pr: 0 })).toThrow(
      '--pr must be a positive integer.',
    )
    expect(() => assertPullTarget({ repo: 'a/b', pr: 1.5 })).toThrow(
      '--pr must be a positive integer.',
    )
    expect(() => createGhFinalReviewIo({ repo: 'x', pr: 1 }, vi.fn())).toThrow('--repo')
  })
})

describe('createGhFinalReviewIo', () => {
  it('reads the head sha', async () => {
    const { io, calls } = setup(['abc123\n'])
    await expect(io.headSha()).resolves.toBe('abc123')
    expect(calls[0]).toEqual([
      'pr',
      'view',
      '7',
      '-R',
      'acme/widgets',
      '--json',
      'headRefOid',
      '-q',
      '.headRefOid',
    ])
  })

  it('lists files', async () => {
    const { io, calls } = setup(['[{"filename":"a.ts","patch":"@@ -1 +1 @@\\n+x\\n"}]'])
    await expect(io.listFiles()).resolves.toEqual([
      { filename: 'a.ts', patch: '@@ -1 +1 @@\n+x\n' },
    ])
    expect(calls[0]).toEqual(['api', '--paginate', 'repos/acme/widgets/pulls/7/files?per_page=100'])
  })

  it('lists review bodies decoded from json lines', async () => {
    const { io, calls } = setup(['"one\\ntwo"\n\n  "three"  \n'])
    await expect(io.listReviewBodies()).resolves.toEqual(['one\ntwo', 'three'])
    expect(calls[0]?.slice(-2)).toEqual(['-q', '.[].body | @json'])
  })

  it('detects the approval label', async () => {
    const yes = setup(['bug\nfinal approval\n'])
    await expect(yes.io.hasApprovalLabel()).resolves.toBe(true)
    const no = setup(['bug\n'])
    await expect(no.io.hasApprovalLabel()).resolves.toBe(false)
  })

  it('posts a review from a temp file and cleans it up', async () => {
    let file = ''
    let content = ''
    const run = vi.fn(async (args: string[]) => {
      file = args[args.indexOf('--input') + 1] as string
      content = readFileSync(file, 'utf8')
      return ' https://example.test/r \n'
    })
    const io = createGhFinalReviewIo(target, run)
    await expect(io.postReview(review)).resolves.toBe('https://example.test/r')
    expect(JSON.parse(content)).toEqual(review)
    expect(existsSync(file)).toBe(false)
    expect(run.mock.calls[0]?.[0].slice(0, 4)).toEqual([
      'api',
      '--method',
      'POST',
      'repos/acme/widgets/pulls/7/reviews',
    ])
  })

  it('cleans up the temp file when gh fails', async () => {
    let file = ''
    const io = createGhFinalReviewIo(target, async (args) => {
      file = args[args.indexOf('--input') + 1] as string
      throw new Error('gh failed')
    })
    await expect(io.postReview(review)).rejects.toThrow('gh failed')
    expect(existsSync(file)).toBe(false)
  })

  it('adds and removes the label', async () => {
    const { io, calls } = setup()
    await io.addApprovalLabel()
    await io.removeApprovalLabel()
    expect(calls[0]).toEqual([
      'api',
      '--method',
      'POST',
      'repos/acme/widgets/issues/7/labels',
      '-f',
      'labels[]=final approval',
    ])
    expect(calls[1]).toEqual([
      'pr',
      'edit',
      '7',
      '-R',
      'acme/widgets',
      '--remove-label',
      'final approval',
    ])
  })

  it('defaults to the gh runner', () => {
    expect(createGhFinalReviewIo(target)).toHaveProperty('headSha')
  })
})
