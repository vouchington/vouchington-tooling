import { describe, expect, it, vi, type Mock } from 'vitest'

import { FinalReviewError, type FinalReviewInput } from './finding.mts'
import type { FinalReviewIo } from './github.mts'
import { finalReviewStatus, postFinalReview, revokeFinalApproval } from './post.mts'
import { reviewMarker, type Verdict } from './render.mts'

const SHA = 'c'.repeat(40)
const OTHER = 'd'.repeat(40)

type MockIo = { [K in keyof FinalReviewIo]: Mock<FinalReviewIo[K]> }

function fakeIo(overrides: Partial<MockIo> = {}): MockIo {
  return {
    headSha: vi.fn(async () => SHA),
    diff: vi.fn(async () => ''),
    listFiles: vi.fn(async () => [{ filename: 'a.ts', patch: '@@ -1 +1 @@\n+x\n' }]),
    listReviewBodies: vi.fn(async () => []),
    hasApprovalLabel: vi.fn(async () => false),
    postReview: vi.fn(async () => 'https://example.test/review'),
    addApprovalLabel: vi.fn(async () => undefined),
    removeApprovalLabel: vi.fn(async () => undefined),
    ...overrides,
  }
}

function input(severity?: 'blocking' | 'high' | 'low'): FinalReviewInput {
  return {
    effort: 'high',
    summary: '',
    skipped: [],
    findings:
      severity === undefined
        ? []
        : [{ pillar: 'rules', severity, title: 'T', body: 'B', path: 'a.ts', line: 1 }],
  }
}

describe('revokeFinalApproval', () => {
  it('removes the label only when present', async () => {
    const absent = fakeIo()
    await expect(revokeFinalApproval(absent)).resolves.toBe(false)
    expect(absent.removeApprovalLabel).not.toHaveBeenCalled()
    const present = fakeIo({ hasApprovalLabel: vi.fn(async () => true) })
    await expect(revokeFinalApproval(present)).resolves.toBe(true)
    expect(present.removeApprovalLabel).toHaveBeenCalledOnce()
  })
})

describe('postFinalReview', () => {
  it('rejects malformed SHAs and a moved head', async () => {
    await expect(postFinalReview(fakeIo(), input(), 'ABC')).rejects.toThrow(FinalReviewError)
    await expect(postFinalReview(fakeIo(), input(), OTHER)).rejects.toThrow(
      /re-review the new head/u,
    )
  })

  it('dry runs without posting', async () => {
    const io = fakeIo()
    const outcome = await postFinalReview(io, input('high'), SHA, { dryRun: true })
    expect(outcome).toMatchObject({ verdict: 'Comment', urls: [], label: 'unchanged' })
    expect(outcome.reviews).toHaveLength(1)
    expect(io.postReview).not.toHaveBeenCalled()
  })

  it('posts and labels an approval', async () => {
    const io = fakeIo()
    const outcome = await postFinalReview(io, input('low'), SHA)
    expect(outcome).toMatchObject({
      verdict: 'Approve',
      urls: ['https://example.test/review'],
      label: 'added',
    })
    expect(io.addApprovalLabel).toHaveBeenCalledOnce()
  })

  it('posts a non-approval, removing a stale label when present', async () => {
    const stale = fakeIo({ hasApprovalLabel: vi.fn(async () => true) })
    await expect(postFinalReview(stale, input('blocking'), SHA)).resolves.toMatchObject({
      verdict: 'Request Changes',
      label: 'removed',
    })
    const clean = fakeIo()
    await expect(postFinalReview(clean, input('high'), SHA)).resolves.toMatchObject({
      label: 'unchanged',
    })
    expect(clean.addApprovalLabel).not.toHaveBeenCalled()
  })
})

describe('finalReviewStatus', () => {
  const body = (sha: string, verdict: Verdict) => reviewMarker(sha, verdict, 'high')

  it('reports no review when none carries a marker', async () => {
    const io = fakeIo({ listReviewBodies: vi.fn(async () => ['LGTM', 'plain']) })
    await expect(finalReviewStatus(io)).resolves.toEqual({
      headSha: SHA,
      reviewedSha: null,
      verdict: null,
      effort: null,
      current: false,
      labeled: false,
      approved: false,
    })
  })

  it('approves only for the newest marker on the current head with the label', async () => {
    const approved = fakeIo({
      listReviewBodies: vi.fn(async () => [
        body(OTHER, 'Request Changes'),
        `x\n${body(SHA, 'Approve')}`,
      ]),
      hasApprovalLabel: vi.fn(async () => true),
    })
    await expect(finalReviewStatus(approved)).resolves.toMatchObject({
      reviewedSha: SHA,
      verdict: 'Approve',
      effort: 'high',
      current: true,
      labeled: true,
      approved: true,
    })
    const stale = fakeIo({
      listReviewBodies: vi.fn(async () => [body(OTHER, 'Approve')]),
      hasApprovalLabel: vi.fn(async () => true),
    })
    await expect(finalReviewStatus(stale)).resolves.toMatchObject({
      current: false,
      approved: false,
    })
    const unlabeled = fakeIo({ listReviewBodies: vi.fn(async () => [body(SHA, 'Approve')]) })
    await expect(finalReviewStatus(unlabeled)).resolves.toMatchObject({ approved: false })
    const commented = fakeIo({
      listReviewBodies: vi.fn(async () => [body(SHA, 'Comment')]),
      hasApprovalLabel: vi.fn(async () => true),
    })
    await expect(finalReviewStatus(commented)).resolves.toMatchObject({ approved: false })
  })
})
