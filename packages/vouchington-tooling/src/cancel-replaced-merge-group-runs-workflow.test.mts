import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse } from 'yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { branch, createHarness, page, run, sha } from './test-helpers/cancel-runs.test-helpers.mts'

type Step = { name?: string; run?: string; uses?: string; timeout?: number }
type Workflow = {
  on?: unknown
  permissions?: Record<string, string>
  concurrency?: { group?: string; 'cancel-in-progress'?: boolean }
  jobs: Record<string, { 'runs-on'?: string; permissions?: Record<string, string>; steps?: Step[] }>
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const workflowText = readFileSync(
  join(root, '.github/workflows/cancel-replaced-merge-group-runs.yml'),
  'utf8',
)
const workflow = parse(workflowText) as Workflow
const job = workflow.jobs.cancel!
const script = job.steps?.[0]?.run ?? 'exit 99'

const entry = branch(14, 'c')
const { setup, teardown, execute } = createHarness(script, {
  HEAD_REF: `refs/heads/${entry}`,
})

describe('cancel replaced merge-group runs workflow', () => {
  it('is workflow_call only and holds one non-required cancel job', () => {
    expect(Object.keys(workflow.on as Record<string, unknown>)).toEqual(['workflow_call'])
    expect(Object.keys(workflow.jobs)).toEqual(['cancel'])
    expect(workflowText).not.toMatch(/voucha|filament|storybook|vouchington-machines|openai/iu)
  })

  it('needs only actions write, checks nothing out, and keeps the ref out of the script', () => {
    expect(workflow.permissions).toEqual({})
    expect(job.permissions).toEqual({ actions: 'write' })
    expect(job['runs-on']).toBe('ubuntu-slim')
    expect(job.steps).toHaveLength(1)
    expect(job.steps?.[0]?.uses).toBeUndefined()
    expect(script).not.toContain('${{')
  })

  it('serializes per merge group without cancelling a running scan', () => {
    expect(workflow.concurrency).toEqual({
      group: 'cancel-replaced-merge-group-runs-${{ github.sha }}',
      'cancel-in-progress': false,
    })
  })
})

describe('cancel replaced merge-group runs script', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('cancels older runs of the same pull request on other queue refs across workflows', () => {
    const result = execute({
      pages: {
        in_progress: [
          page(
            run(100, 'Backend', branch(14, 'a')),
            run(101, 'Web', branch(14, 'a')),
            run(102, 'Backend', branch(14, 'b')),
          ),
        ],
        queued: [page(run(103, 'Static', branch(14, 'a')))],
      },
    })
    expect(result.status).toBe(0)
    expect(result.cancelled).toEqual([100, 101, 102, 103])
    expect(result.summary).toContain('PR #14')
    expect(result.summary).toContain(
      '| Web | [101](https://github.test/example/repo/actions/runs/101)',
    )
  })

  it('keeps this entry, newer entries, other pull requests, and prefix look-alikes', () => {
    const result = execute({
      pages: {
        in_progress: [
          page(
            run(100, 'Backend', entry),
            run(900, 'Backend', branch(14, 'd')),
            run(110, 'Backend', branch(15, 'a')),
            run(111, 'Backend', branch(140, 'a')),
            run(112, 'Backend', `gh-readonly-queue/release/pr-14-${sha('a')}`),
            run(113, 'Backend', null),
            run(120, 'Backend', branch(14, 'a')),
          ),
        ],
      },
    })
    expect(result.status).toBe(0)
    expect(result.cancelled).toEqual([120])
  })

  it('lists every active status across all pages and cancels from each page', () => {
    const result = execute({
      pages: {
        queued: [page(run(10, 'Web', branch(14, 'a'))), page(run(11, 'Web', branch(14, 'b')))],
        waiting: [page(run(12, 'Lambdas', branch(14, 'a')))],
        requested: [page(run(13, 'Tooling', branch(14, 'a')))],
        pending: [page(run(14, 'Static', branch(14, 'b')))],
      },
    })
    expect(result.cancelled).toEqual([10, 11, 12, 13, 14])
    expect(result.calls.filter((call) => call.includes('/actions/runs?'))).toEqual(
      ['queued', 'in_progress', 'waiting', 'requested', 'pending'].map(
        (status) =>
          `api --paginate repos/example/repo/actions/runs?event=merge_group&status=${status}&per_page=100`,
      ),
    )
  })

  it('cancels a run once when it changes status between two lists', () => {
    const duplicate = run(30, 'Backend', branch(14, 'a'))
    const result = execute({ pages: { queued: [page(duplicate)], in_progress: [page(duplicate)] } })
    expect(result.cancelled).toEqual([30])
  })

  it('reports no work when no older entry is active', () => {
    const result = execute({})
    expect(result.status).toBe(0)
    expect(result.cancelled).toEqual([])
    expect(result.summary).toContain('No older queue entry of this pull request had an active run.')
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

  it('keeps cancelling after a cancel error, then fails the job', () => {
    const result = execute({
      pages: {
        in_progress: [page(run(50, 'Backend', branch(14, 'a')), run(51, 'Web', branch(14, 'a')))],
      },
      errors: [50],
    })
    expect(result.status).toBe(1)
    expect(result.cancelled).toEqual([51])
    expect(result.stdout).toContain('::warning::Could not cancel run 50')
    expect(result.calls.filter((call) => call.includes('/runs/50/cancel'))).toHaveLength(1)
  })

  it('fails without touching the API when the merge-group ref is unexpected', () => {
    const result = execute({ env: { HEAD_REF: 'refs/heads/main' } })
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('::error::Unexpected merge group ref')
    expect(result.calls).toEqual([])
  })
})
