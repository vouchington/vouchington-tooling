import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runGh, type RunTextCommand } from '../gh-cli/index.mts'
import {
  parseReviewFilesJson,
  type ReviewFile,
  type SanitizedReview,
} from '../gha-review-payload/index.mts'
import { FINAL_APPROVAL_LABEL } from './render.mts'

/** The GitHub reads and writes a final review needs, injectable for tests. */
export type FinalReviewIo = {
  headSha(): Promise<string>
  listFiles(): Promise<ReviewFile[]>
  listReviewBodies(): Promise<string[]>
  hasApprovalLabel(): Promise<boolean>
  postReview(review: SanitizedReview): Promise<string>
  addApprovalLabel(): Promise<void>
  removeApprovalLabel(): Promise<void>
}

export type PullTarget = { repo: string; pr: number }

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u

export function assertPullTarget(target: PullTarget): void {
  if (!REPO_RE.test(target.repo)) throw new Error('--repo must be owner/name.')
  if (!Number.isInteger(target.pr) || target.pr <= 0)
    throw new Error('--pr must be a positive integer.')
}

function lines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

/** Builds `FinalReviewIo` on top of the authenticated `gh` CLI. */
export function createGhFinalReviewIo(
  target: PullTarget,
  run: RunTextCommand = runGh,
): FinalReviewIo {
  assertPullTarget(target)
  const { repo, pr } = target
  const pull = `repos/${repo}/pulls/${pr}`
  return {
    async headSha() {
      return (
        await run([
          'pr',
          'view',
          String(pr),
          '-R',
          repo,
          '--json',
          'headRefOid',
          '-q',
          '.headRefOid',
        ])
      ).trim()
    },
    async listFiles() {
      return parseReviewFilesJson(await run(['api', '--paginate', `${pull}/files?per_page=100`]))
    },
    async listReviewBodies() {
      const out = await run([
        'api',
        '--paginate',
        `${pull}/reviews?per_page=100`,
        '-q',
        '.[].body | @json',
      ])
      return lines(out).map((line) => JSON.parse(line) as string)
    },
    async hasApprovalLabel() {
      const out = await run([
        'pr',
        'view',
        String(pr),
        '-R',
        repo,
        '--json',
        'labels',
        '-q',
        '.labels[].name',
      ])
      return lines(out).includes(FINAL_APPROVAL_LABEL)
    },
    async postReview(review) {
      const dir = mkdtempSync(join(tmpdir(), 'final-review-'))
      try {
        const file = join(dir, 'review.json')
        writeFileSync(file, JSON.stringify(review))
        const out = await run([
          'api',
          '--method',
          'POST',
          `${pull}/reviews`,
          '--input',
          file,
          '-q',
          '.html_url',
        ])
        return out.trim()
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
    async addApprovalLabel() {
      // The issues labels endpoint creates a missing label, so no separate setup step is needed.
      await run([
        'api',
        '--method',
        'POST',
        `repos/${repo}/issues/${pr}/labels`,
        '-f',
        `labels[]=${FINAL_APPROVAL_LABEL}`,
      ])
    },
    async removeApprovalLabel() {
      await run(['pr', 'edit', String(pr), '-R', repo, '--remove-label', FINAL_APPROVAL_LABEL])
    },
  }
}
