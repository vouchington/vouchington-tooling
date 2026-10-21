import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse } from 'yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  branch,
  createHarness,
  jobsOf,
  page,
  run,
  sha,
} from './test-helpers/cancel-runs.test-helpers.mts'

type Job = {
  if?: string
  'runs-on'?: string
  permissions?: Record<string, string>
  steps?: { run?: string; uses?: string; env?: Record<string, string> }[]
}
type Workflow = {
  on?: unknown
  permissions?: Record<string, string>
  concurrency?: { group?: string; 'cancel-in-progress'?: boolean }
  jobs: Record<string, Job>
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const workflowText = readFileSync(
  join(root, '.github/workflows/cancel-dequeued-merge-group-runs.yml'),
  'utf8',
)
const workflow = parse(workflowText) as Workflow
const job = workflow.jobs.cancel!
const script = job.steps?.[0]?.run ?? 'exit 99'
const { setup, teardown, execute } = createHarness(script)

// Reasons come from the pull_request `dequeued` webhook enum in GitHub's webhook documentation.
const allowed = [
  'MANUAL',
  'CI_FAILURE',
  'MERGE_CONFLICT',
  'QUEUE_CLEARED',
  'ROLL_BACK',
  'BRANCH_PROTECTIONS',
  'GIT_TREE_INVALID',
  'INVALID_MERGE_COMMIT',
]
const ignored = ['MERGE', 'ALREADY_MERGED', 'UNKNOWN_REMOVAL_REASON', 'CI_TIMEOUT', 'FUTURE_REASON']

describe('cancel dequeued merge-group runs workflow', () => {
  it('is workflow_call only and holds one cancel job', () => {
    expect(Object.keys(workflow.on as Record<string, unknown>)).toEqual(['workflow_call'])
    expect(workflow.on).toMatchObject({
      workflow_call: { inputs: { 'queue-base': { type: 'string', default: 'main' } } },
    })
    expect(Object.keys(workflow.jobs)).toEqual(['cancel'])
    expect(workflowText).not.toMatch(/voucha|filament|storybook|vouchington-machines|openai/iu)
  })

  it('needs only actions write and pull-request read, checks nothing out, and uses env only', () => {
    expect(workflow.permissions).toEqual({})
    expect(job.permissions).toEqual({ actions: 'write', 'pull-requests': 'read' })
    expect(job['runs-on']).toBe('ubuntu-slim')
    expect(job.steps).toHaveLength(1)
    expect(job.steps?.[0]?.uses).toBeUndefined()
    expect(script).not.toContain('${{')
    expect(job.steps?.[0]?.env).toMatchObject({
      PR_NUMBER: '${{ github.event.pull_request.number }}',
      QUEUE_BASE: '${{ inputs.queue-base }}',
      REASON: '${{ github.event.reason }}',
    })
    expect(script).toContain('gh-readonly-queue/${QUEUE_BASE}/pr-${PR_NUMBER}-')
  })

  it('serializes per pull request without cancelling a running scan', () => {
    expect(workflow.concurrency).toEqual({
      group: 'cancel-dequeued-merge-group-runs-${{ github.event.pull_request.number }}',
      'cancel-in-progress': false,
    })
  })

  it('skips the job for every reason outside the allowlist', () => {
    const list = /^contains\(fromJSON\('(\[[^']*\])'\), github\.event\.reason\)$/u.exec(
      job.if?.trim() ?? '',
    )?.[1]
    expect(JSON.parse(list ?? '[]')).toEqual(allowed)
  })
})

describe('cancel dequeued merge-group runs script', () => {
  beforeEach(setup)

  afterEach(teardown)

  it.each(allowed)('cancels active runs when the reason is %s', (reason) => {
    const result = execute({
      reason,
      pages: { in_progress: [page(run(100, 'Web', branch(14, 'a')))] },
    })
    expect(result.status).toBe(0)
    expect(result.cancelled).toEqual([100])
    expect(result.summary).toContain(`PR #14 (${reason})`)
  })

  it.each(ignored)('does nothing when the reason is %s', (reason) => {
    const result = execute({
      reason,
      pages: { in_progress: [page(run(100, 'Web', branch(14, 'a')))] },
    })
    expect(result.status).toBe(0)
    expect(result.cancelled).toEqual([])
    expect(result.calls).toEqual([])
  })

  it('does nothing for a merged pull request', () => {
    const result = execute({
      merged: true,
      pages: { in_progress: [page(run(100, 'Publish', branch(14, 'a')))] },
    })
    expect(result.status).toBe(0)
    expect(result.cancelled).toEqual([])
    expect(result.calls).toEqual(['api repos/example/repo/pulls/14 --jq .merged'])
    expect(result.summary).toContain('The pull request is merged')
  })

  it('matches only this pull request on the main queue, so 14 never matches 140', () => {
    const pages = {
      in_progress: [
        page(
          run(100, 'Backend', branch(14, 'a')),
          run(101, 'Backend', branch(140, 'a')),
          run(102, 'Backend', branch(1, 'a')),
          run(103, 'Backend', branch(4, 'a')),
          run(104, 'Backend', branch(15, 'a')),
          run(105, 'Backend', `gh-readonly-queue/release/pr-14-${sha('a')}`),
          run(106, 'Backend', 'gh-readonly-queue/main/pr-14'),
          run(107, 'Backend', null),
          run(108, 'Backend', branch(14, 'b')),
        ),
      ],
    }
    expect(execute({ pages }).cancelled).toEqual([100, 108])
    expect(execute({ pages, pr: '140' }).cancelled).toEqual([101])
  })

  it('keeps this run, newer runs, and fresh runs that reuse the same queue ref', () => {
    const result = execute({
      pages: {
        in_progress: [
          page(
            run(100, 'Backend', branch(14, 'a')),
            run(499, 'Web', branch(14, 'a')),
            run(500, 'Static', branch(14, 'a')),
            run(900, 'Backend', branch(14, 'a')),
            run(901, 'Backend', branch(14, 'b')),
          ),
        ],
      },
    })
    expect(result.cancelled).toEqual([100, 499])
  })

  it('lists every active status across all pages and cancels each run once', () => {
    const repeated = run(30, 'Backend', branch(14, 'a'))
    const result = execute({
      pages: {
        queued: [
          page(run(10, 'Web', branch(14, 'a'))),
          page(run(11, 'Web', branch(14, 'b')), repeated),
        ],
        in_progress: [page(repeated)],
        waiting: [page(run(12, 'Lambdas', branch(14, 'a')))],
        requested: [page(run(13, 'Tooling', branch(14, 'a')))],
        pending: [page(run(14, 'Static', branch(14, 'b')))],
      },
    })
    expect(result.cancelled).toEqual([10, 11, 12, 13, 14, 30])
    expect(result.calls.filter((call) => call.includes('/actions/runs?'))).toEqual(
      ['queued', 'in_progress', 'waiting', 'requested', 'pending'].map(
        (status) =>
          `api --paginate repos/example/repo/actions/runs?event=merge_group&status=${status}&per_page=100`,
      ),
    )
  })

  it('keeps a run that already holds a failed job so the failure stays triageable', () => {
    const result = execute({
      pages: {
        in_progress: [
          page(
            run(20, 'Backend', branch(14, 'a')),
            run(21, 'Web', branch(14, 'a')),
            run(22, 'Tooling', branch(14, 'a')),
            run(23, 'Lambdas', branch(14, 'a')),
          ),
        ],
      },
      jobs: {
        20: jobsOf('success', 'failure'),
        21: jobsOf('success', 'in_progress', 'cancelled'),
        22: jobsOf('timed_out'),
      },
    })
    expect(result.status).toBe(0)
    expect(result.cancelled).toEqual([21, 23])
    expect(result.summary).toContain('| Backend | [20]')
    expect(result.summary).toContain('kept: holds a failed job')
  })

  it('writes the cancelled run ids to the job summary', () => {
    const result = execute({
      pages: {
        in_progress: [page(run(101, 'Web', branch(14, 'a')), run(102, 'Backend', branch(14, 'b')))],
      },
    })
    expect(result.summary).toContain('PR #14 (CI_FAILURE)')
    expect(result.summary).toContain(
      `| Web | [101](https://github.test/example/repo/actions/runs/101) | \`${branch(14, 'a')}\` | cancelled |`,
    )
    expect(result.summary).toContain('/actions/runs/102)')
  })

  it('reports none active when the pull request has no active run', () => {
    const result = execute({})
    expect(result.status).toBe(0)
    expect(result.cancelled).toEqual([])
    expect(result.summary).toContain('Cancelled runs: none active.')
  })

  it('retries a transient HTTP 502 and then cancels the run', () => {
    const result = execute({
      pages: { in_progress: [page(run(60, 'Web', branch(14, 'a')))] },
      transient: [60],
    })
    expect(result.status).toBe(0)
    expect(result.cancelled).toEqual([60])
    expect(result.summary).toContain('| cancelled |')
    expect(result.calls.filter((call) => call.includes('--method POST'))).toHaveLength(2)
  })

  it('fails the job when a cancel HTTP 502 persists past three attempts', () => {
    const result = execute({
      pages: { in_progress: [page(run(61, 'Web', branch(14, 'a')))] },
      transient: [61],
      transientFailures: 3,
    })
    expect(result.status).toBe(1)
    expect(result.cancelled).toEqual([])
    expect(result.stdout).toContain('::warning::Could not cancel run 61')
    expect(result.summary).toContain('| failed |')
    expect(result.calls.filter((call) => call.includes('--method POST'))).toHaveLength(3)
  })

  it('treats a run that already completed as success', () => {
    const result = execute({
      pages: { in_progress: [page(run(40, 'Backend', branch(14, 'a')))] },
      conflicts: [40],
    })
    expect(result.status).toBe(0)
    expect(result.cancelled).toEqual([])
    expect(result.summary).toContain('already completed')
  })

  it('keeps going after a cancel or job-list error, then fails the job', () => {
    const result = execute({
      pages: {
        in_progress: [
          page(
            run(50, 'Backend', branch(14, 'a')),
            run(51, 'Web', branch(14, 'a')),
            run(52, 'Tooling', branch(14, 'a')),
          ),
        ],
      },
      errors: [50],
      jobErrors: [52],
    })
    expect(result.status).toBe(1)
    expect(result.cancelled).toEqual([51])
    expect(result.stdout).toContain('::warning::Could not cancel run 50')
    expect(result.calls.filter((call) => call.includes('/runs/50/cancel'))).toHaveLength(1)
    expect(result.stdout).toContain('::warning::Could not read the jobs of run 52')
  })

  it('fails without touching the API when the pull-request number is not numeric', () => {
    const result = execute({ pr: '14-or-1' })
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('::error::Unexpected pull request number')
    expect(result.calls).toEqual([])
  })

  it('uses the queue base when matching the readonly queue prefix', () => {
    const release = `gh-readonly-queue/release/pr-14-${sha('a')}`
    const pages = {
      in_progress: [page(run(100, 'Web', branch(14, 'a')), run(101, 'Web', release))],
    }
    expect(execute({ pages }).cancelled).toEqual([100])
    expect(execute({ pages, queueBase: 'release' }).cancelled).toEqual([101])
  })

  it('fails without touching the API when the queue base is not a single branch name', () => {
    const result = execute({ queueBase: 'release/1' })
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('::error::queue-base must be a single branch name')
    expect(result.calls).toEqual([])
  })
})
