import { indexReviewFiles, type SanitizedReview } from '../gha-review-payload/index.mts'
import { buildFinalReviews, DEFAULT_LIMITS, type BuildLimits } from './build.mts'
import { FinalReviewError, type FinalReviewInput } from './finding.mts'
import type { FinalReviewIo } from './github.mts'
import { deriveVerdict, type Verdict } from './render.mts'

export type PostOutcome = {
  verdict: Verdict
  reviews: SanitizedReview[]
  urls: string[]
  label: 'added' | 'removed' | 'unchanged'
}

const SHA_RE = /^[0-9a-f]{40}$/u

/** Removes a stale `final approval` label; run before every re-review. */
export async function revokeFinalApproval(io: FinalReviewIo): Promise<boolean> {
  if (!(await io.hasApprovalLabel())) return false
  await io.removeApprovalLabel()
  return true
}

/**
 * Renders the reviews for `headSha` and, unless `dryRun`, posts them and sets the label. Refuses
 * when the pull request head moved, because the findings describe an older commit.
 */
export async function postFinalReview(
  io: FinalReviewIo,
  input: FinalReviewInput,
  headSha: string,
  options: { dryRun?: boolean; limits?: BuildLimits } = {},
): Promise<PostOutcome> {
  if (!SHA_RE.test(headSha)) throw new FinalReviewError('--head-sha must be a full lowercase SHA.')
  const current = await io.headSha()
  if (current !== headSha) {
    throw new FinalReviewError(
      `Pull request head is ${current}, not the reviewed ${headSha}; re-review the new head.`,
    )
  }
  const index = indexReviewFiles(await io.listFiles())
  const reviews = buildFinalReviews(input, headSha, index, options.limits ?? DEFAULT_LIMITS)
  const verdict = deriveVerdict(input.findings)
  if (options.dryRun === true) return { verdict, reviews, urls: [], label: 'unchanged' }
  const urls: string[] = []
  for (const review of reviews) urls.push(await io.postReview(review))
  if (verdict === 'Approve') {
    await io.addApprovalLabel()
    return { verdict, reviews, urls, label: 'added' }
  }
  const removed = await revokeFinalApproval(io)
  return { verdict, reviews, urls, label: removed ? 'removed' : 'unchanged' }
}

export type ReviewStatus = {
  headSha: string
  reviewedSha: string | null
  verdict: string | null
  effort: string | null
  current: boolean
  labeled: boolean
  /** True only when the newest final review approved the current head and the label is on. */
  approved: boolean
}

const MARKER_RE = /<!-- final-review sha=([0-9a-f]{40}) verdict=([A-Za-z-]+) effort=([a-z]+) -->/u

/** Reports whether the latest final review covers the current head, for merging agents. */
export async function finalReviewStatus(io: FinalReviewIo): Promise<ReviewStatus> {
  const [headSha, bodies, labeled] = await Promise.all([
    io.headSha(),
    io.listReviewBodies(),
    io.hasApprovalLabel(),
  ])
  const latest = bodies
    .map((body) => MARKER_RE.exec(body))
    .filter((match): match is RegExpExecArray => match !== null)
    .at(-1)
  const reviewedSha = latest?.[1] ?? null
  const verdict = latest?.[2] ?? null
  const current = reviewedSha === headSha
  return {
    headSha,
    reviewedSha,
    verdict,
    effort: latest?.[3] ?? null,
    current,
    labeled,
    approved: current && labeled && verdict === 'Approve',
  }
}
