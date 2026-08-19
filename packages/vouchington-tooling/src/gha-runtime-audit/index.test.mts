import { describe, expect, it } from 'vitest'

import {
  auditCiJobRuntime,
  violationOrder,
  type GhApiExecutor,
  type RuntimeJobResult,
} from './index.mts'
import { exampleAuditOptions, makeExecutor, makeJob, makeRun } from './index.test-helpers.mts'
import { isRunInScope, parseWorkflowNameMatch, resolveRuntimeAuditOptions } from './scope.mts'

function audit(execute: GhApiExecutor, repository = 'owner/repo') {
  return auditCiJobRuntime(execute, { repository, ...exampleAuditOptions })
}

describe('gha-runtime-audit', () => {
  it('discovers a conditional job after five ubiquitous completed runs', async () => {
    const runs = Array.from({ length: 10 }, (_, index) => makeRun(10 - index, 'CI', 'pull_request'))
    const jobs = Object.fromEntries(
      Array.from({ length: 10 }, (_, index) => {
        const runId = 10 - index
        return [
          runId,
          [
            makeJob(runId, 'common', 100),
            ...(runId === 5 ? [makeJob(50, 'conditional', 200)] : []),
          ],
        ]
      }),
    )

    const result = await audit(makeExecutor(runs, jobs))

    expect(result.scope.recentCompletedRunHorizon).toBe(10)
    expect(result.jobs.find((job) => job.key === 'CI / common')?.sampleCount).toBe(5)
    expect(result.jobs.find((job) => job.key === 'CI / conditional')?.sampleCount).toBe(1)
  })

  it('samples successful jobs from a failed completed workflow run', async () => {
    const run = makeRun(1, 'CI', 'pull_request', 'main', 'failure')
    const jobs = {
      1: [makeJob(1, 'successful sibling', 100), makeJob(2, 'failed sibling', 100, 0, 'failure')],
    }

    const result = await audit(makeExecutor([run], jobs))

    expect(result.jobs.map((job) => job.key)).toEqual(['CI / successful sibling'])
  })

  it('paginates workflow discovery and selects only configured workflows', async () => {
    const requests: string[] = []
    const execute: GhApiExecutor = async (request) => {
      requests.push(request.endpoint)
      if (request.endpoint.includes('/actions/workflows?')) {
        const page = Number(
          new URL(`https://github.test${request.endpoint}`).searchParams.get('page'),
        )
        return {
          workflows:
            page === 1
              ? Array.from({ length: 100 }, (_, index) => ({
                  id: index + 100,
                  name: `Other ${index}`,
                  state: 'active',
                }))
              : page === 2
                ? [
                    { id: 1, name: 'CI', state: 'active' },
                    { id: 2, name: 'Main CI (web)', state: 'disabled_manually' },
                  ]
                : [],
        }
      }
      if (request.endpoint.includes('/actions/workflows/1/runs?')) {
        return { workflow_runs: [makeRun(1, 'CI', 'pull_request')] }
      }
      if (request.endpoint.includes('/actions/runs/1/jobs')) {
        return { jobs: [makeJob(1, 'test', 100)] }
      }
      throw new Error(`Unexpected request: ${request.endpoint}`)
    }

    const result = await audit(execute)

    expect(requests).toContain('/repos/owner/repo/actions/workflows?per_page=100&page=2')
    expect(requests.some((endpoint) => endpoint.includes('/actions/workflows/1/runs?'))).toBe(true)
    expect(requests.some((endpoint) => endpoint.includes('/actions/workflows/2/runs?'))).toBe(false)
    expect(result.jobs.map((job) => job.key)).toEqual(['CI / test'])
  })

  it('uses workflow-specific projected API requests', async () => {
    const requests: Array<{ endpoint: string; jq: string }> = []
    const execute: GhApiExecutor = async (request) => {
      requests.push(request)
      if (request.endpoint.includes('/actions/workflows?')) {
        return { workflows: [{ id: 42, name: 'CI', state: 'active' }] }
      }
      if (request.endpoint.includes('/actions/workflows/42/runs?')) {
        return { workflow_runs: [makeRun(1, 'CI', 'pull_request')] }
      }
      return { jobs: [makeJob(1, 'test', 100)] }
    }

    await audit(execute)

    expect(requests.some((request) => request.endpoint.includes('/actions/runs?'))).toBe(false)
    expect(
      requests.find((request) => request.endpoint.includes('/actions/workflows/42/runs?'))
        ?.endpoint,
    ).toContain('status=completed')
    expect(requests.map((request) => request.jq)).toEqual([
      '{workflows: [.workflows[] | {id, name, state}]}',
      '{workflow_runs: [.workflow_runs[] | {id, name, event, conclusion, created_at, html_url, head_branch, pull_requests: [(.pull_requests // [])[] | {base: {ref: .base.ref}}]}]}',
      '{jobs: [.jobs[] | {id, name, started_at, completed_at, conclusion, html_url}]}',
    ])
  })

  it('scopes successful PR and main runs, excludes queue time, and samples the latest five jobs', async () => {
    const runs = [
      ...[7, 6, 5, 4, 3, 2].map((id) => makeRun(id, 'CI', 'pull_request')),
      makeRun(8, 'CI', 'pull_request', 'release'),
      makeRun(9, 'Main CI (web)', 'push'),
      makeRun(10, 'Main CI (web)', 'push', 'release'),
      makeRun(11, 'Other', 'push'),
    ]
    const jobs = Object.fromEntries(
      [2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((id) => [id, [makeJob(id, 'test', 300 + id, 12)]]),
    )

    const result = await audit(makeExecutor(runs, jobs))

    expect(result.jobs.map((job) => job.key)).toEqual(['CI / test', 'Main CI (web) / test'])
    expect(result.jobs[0]?.samples.map((sample) => sample.runId)).toEqual([7, 6, 5, 4, 3])
    expect(result.jobs[0]?.samples[0]?.durationSeconds).toBe(307)
  })

  it('flags an eligible median above the threshold and ranks hard breaches first', async () => {
    const runs = [5, 4, 3, 2, 1].map((id) => makeRun(id, 'CI', 'pull_request'))
    const jobs = Object.fromEntries(
      runs.map((_, index) => {
        const id = 5 - index
        return [
          id,
          [makeJob(id, 'median', 361 + index), makeJob(id + 20, 'hard', index === 0 ? 600 : 100)],
        ]
      }),
    )

    const result = await audit(makeExecutor(runs, jobs))

    expect(result.violations.map((job) => job.key)).toEqual(['CI / hard', 'CI / median'])
    expect(result.violations[0]?.reasons).toEqual(['sample-at-or-above-hard-ceiling'])
    expect(result.violations[1]?.medianSeconds).toBe(363)
    expect(result.violations[1]?.reasons).toEqual(['five-sample-median-above-threshold'])
  })

  it('does not apply the median rule to fewer than five samples', async () => {
    const runs = [2, 1].map((id) => makeRun(id, 'CI', 'pull_request'))
    const jobs = Object.fromEntries(
      runs.map((_, index) => [2 - index, [makeJob(2 - index, 'test', 500)]]),
    )

    const result = await audit(makeExecutor(runs, jobs))

    expect(result.jobs[0]?.medianSeconds).toBeNull()
    expect(result.violations).toEqual([])
  })

  it('paginates successful runs so sparse exact job names are sampled', async () => {
    const runs = [
      ...[101, 100, 99, 98].map((id) => makeRun(id, 'CI', 'pull_request')),
      ...Array.from({ length: 96 }, (_, index) =>
        makeRun(97 - index, 'CI', 'pull_request', 'release'),
      ),
      makeRun(1, 'CI', 'pull_request'),
    ]
    const execute: GhApiExecutor = async (request) => {
      const { endpoint } = request
      if (endpoint.includes('/actions/workflows?')) {
        return { workflows: [{ id: 1, name: 'CI', state: 'active' }] }
      }
      if (endpoint.includes('/actions/workflows/1/runs?')) {
        const page = Number(new URL(`https://github.test${endpoint}`).searchParams.get('page'))
        return { workflow_runs: runs.slice((page - 1) * 100, page * 100) }
      }
      const runId = Number(endpoint.match(/\/actions\/runs\/(\d+)\/jobs/)?.[1])
      return { jobs: [makeJob(runId, runId === 1 ? 'sparse' : 'common', 100)] }
    }

    const result = await audit(execute)

    expect(result.jobs.find((job) => job.key === 'CI / sparse')?.sampleCount).toBe(1)
  })

  it('fails closed on malformed GitHub API data', async () => {
    const execute: GhApiExecutor = async () => ({ workflows: [{ id: 'not-a-number' }] })

    await expect(audit(execute)).rejects.toThrow('Malformed GitHub API')
  })

  it('rejects a missing repository or workflow filter', () => {
    expect(() => resolveRuntimeAuditOptions({ repository: 'bad', workflows: [] })).toThrow(
      'owner/name',
    )
    expect(() => resolveRuntimeAuditOptions({ repository: 'owner/repo', workflows: [] })).toThrow(
      'At least one workflow filter is required',
    )
  })

  it('parses exact and regex workflow name matches', () => {
    expect(parseWorkflowNameMatch('CI')).toBe('CI')
    expect(parseWorkflowNameMatch('/^Main CI \\(.+\\)$/')).toEqual(/^Main CI \(.+\)$/)
    expect(parseWorkflowNameMatch('/foo')).toBe('/foo')
    expect(parseWorkflowNameMatch('/')).toBe('/')
  })

  it('treats a push run as out of scope when the event or branch does not match', () => {
    const filter = { name: /^Main CI \(.+\)$/, event: 'push' as const }
    expect(
      isRunInScope(
        {
          id: 1,
          name: 'Main CI (web)',
          event: 'pull_request',
          conclusion: 'success',
          createdAt: '2026-01-01T00:00:00.000Z',
          url: 'https://github.test/runs/1',
          headBranch: 'main',
          pullRequestBaseBranches: ['main'],
        },
        filter,
        'main',
      ),
    ).toBe(false)
    expect(
      isRunInScope(
        {
          id: 2,
          name: 'Main CI (web)',
          event: 'push',
          conclusion: 'success',
          createdAt: '2026-01-01T00:00:00.000Z',
          url: 'https://github.test/runs/2',
          headBranch: null,
          pullRequestBaseBranches: [],
        },
        filter,
        'main',
      ),
    ).toBe(false)
  })

  it('rejects inverted job timestamps', async () => {
    const execute: GhApiExecutor = async (request) => {
      if (request.endpoint.includes('/actions/workflows?')) {
        return { workflows: [{ id: 1, name: 'CI', state: 'active' }] }
      }
      if (request.endpoint.includes('/runs?')) {
        return { workflow_runs: [makeRun(1, 'CI', 'pull_request')] }
      }
      return {
        jobs: [
          {
            id: 1,
            name: 'inverted',
            started_at: '2026-01-02T00:00:00.000Z',
            completed_at: '2026-01-01T00:00:00.000Z',
            conclusion: 'success',
            html_url: 'https://github.test/jobs/1',
          },
        ],
      }
    }

    await expect(audit(execute)).rejects.toThrow('invalid execution interval')
  })

  it('paginates jobs within a run', async () => {
    const execute: GhApiExecutor = async (request) => {
      if (request.endpoint.includes('/actions/workflows?')) {
        return { workflows: [{ id: 1, name: 'CI', state: 'active' }] }
      }
      if (request.endpoint.includes('/runs?')) {
        return { workflow_runs: [makeRun(1, 'CI', 'pull_request')] }
      }
      const page = Number(
        new URL(`https://github.test${request.endpoint}`).searchParams.get('page'),
      )
      if (page === 1) {
        return {
          jobs: Array.from({ length: 100 }, (_, index) =>
            makeJob(1000 + index, `page-${index}`, 10),
          ),
        }
      }
      return { jobs: [makeJob(1, 'test', 100)] }
    }

    const result = await audit(execute)
    expect(result.jobs.some((job) => job.job === 'test')).toBe(true)
    expect(result.jobs.length).toBeGreaterThan(1)
  })

  it('queries push workflows by branch and skips a duplicate run id', async () => {
    const requests: string[] = []
    const execute: GhApiExecutor = async (request) => {
      requests.push(request.endpoint)
      if (request.endpoint.includes('/actions/workflows?')) {
        return {
          workflows: [
            { id: 1, name: 'CI', state: 'active' },
            { id: 2, name: 'Main CI (web)', state: 'active' },
          ],
        }
      }
      if (request.endpoint.includes('/actions/workflows/1/runs?')) {
        return { workflow_runs: [makeRun(99, 'CI', 'pull_request')] }
      }
      if (request.endpoint.includes('/actions/workflows/2/runs?')) {
        return { workflow_runs: [makeRun(99, 'Main CI (web)', 'push')] }
      }
      return { jobs: [makeJob(99, 'test', 100)] }
    }

    const result = await audit(execute)
    expect(requests.some((endpoint) => endpoint.includes('event=push&branch=main'))).toBe(true)
    expect(requests.filter((endpoint) => endpoint.includes('/actions/runs/99/jobs')).length).toBe(1)
    expect(result.jobs.map((job) => job.key)).toEqual(['CI / test'])
  })

  it('breaks the horizon on extra same-page runs and sorts same-day ids', async () => {
    const sameDay = '2026-02-01T00:00:00.000Z'
    const runs = [
      makeRun(3, 'CI', 'pull_request', 'main', 'success', sameDay),
      makeRun(2, 'CI', 'pull_request', 'main', 'success', sameDay),
      ...Array.from({ length: 10 }, (_, index) => makeRun(20 - index, 'CI', 'pull_request')),
    ]
    const fetched: number[] = []
    const execute: GhApiExecutor = async (request) => {
      if (request.endpoint.includes('/actions/workflows?')) {
        return { workflows: [{ id: 1, name: 'CI', state: 'active' }] }
      }
      if (request.endpoint.includes('/runs?')) return { workflow_runs: runs }
      const runId = Number(request.endpoint.match(/\/actions\/runs\/(\d+)\/jobs/)?.[1])
      fetched.push(runId)
      return { jobs: [makeJob(runId, 'test', 100)] }
    }

    await auditCiJobRuntime(execute, {
      repository: 'owner/repo',
      ...exampleAuditOptions,
      recentCompletedRunHorizon: 10,
    })
    expect(fetched).toHaveLength(10)
    expect(fetched[0]).toBe(3)
    expect(fetched[1]).toBe(2)
    expect(fetched).not.toContain(11)
  })

  it('orders mixed violations in both comparison directions', () => {
    const hard: RuntimeJobResult = {
      key: 'CI / hard',
      workflow: 'CI',
      job: 'hard',
      sampleCount: 1,
      medianSeconds: null,
      maximumSeconds: 700,
      reasons: ['sample-at-or-above-hard-ceiling'],
      samples: [],
    }
    const median: RuntimeJobResult = {
      key: 'CI / median',
      workflow: 'CI',
      job: 'median',
      sampleCount: 5,
      medianSeconds: 400,
      maximumSeconds: 400,
      reasons: ['five-sample-median-above-threshold'],
      samples: [],
    }
    expect(violationOrder(hard, median)).toBeLessThan(0)
    expect(violationOrder(median, hard)).toBeGreaterThan(0)
    expect(violationOrder(hard, { ...hard, key: 'CI / hard-z' })).toBeLessThan(0)
  })

  it('ranks two hard ceilings by max, then equal scores by job key', async () => {
    const runs = [5, 4, 3, 2, 1].map((id) => makeRun(id, 'CI', 'pull_request'))
    const jobs = Object.fromEntries(
      runs.map((_, index) => {
        const id = 5 - index
        return [
          id,
          [
            makeJob(id, 'hard-b', index === 0 ? 800 : 100),
            makeJob(id + 10, 'hard-a', index === 0 ? 700 : 100),
            makeJob(id + 20, 'median-b', 400),
            makeJob(id + 30, 'median-a', 400),
          ],
        ]
      }),
    )

    const result = await audit(makeExecutor(runs, jobs))
    expect(result.violations.map((job) => job.key)).toEqual([
      'CI / hard-b',
      'CI / hard-a',
      'CI / median-a',
      'CI / median-b',
    ])
  })

  it('accepts explicit options and a null head_branch on a PR run', async () => {
    const execute: GhApiExecutor = async (request) => {
      if (request.endpoint.includes('/actions/workflows?')) {
        return { workflows: [{ id: 1, name: 'CI', state: 'active' }] }
      }
      if (request.endpoint.includes('/runs?')) {
        return {
          workflow_runs: [
            makeRun(1, 'CI', 'pull_request', 'develop', 'success', undefined, null),
            makeRun(2, 'CI', 'workflow_dispatch' as 'pull_request', 'develop'),
          ],
        }
      }
      return { jobs: [makeJob(1, 'test', 100)] }
    }

    const result = await auditCiJobRuntime(execute, {
      repository: 'owner/repo',
      workflows: [{ name: 'CI', event: 'pull_request' }],
      branch: 'develop',
      sampleLimit: 3,
      recentCompletedRunHorizon: 4,
      medianThresholdSeconds: 120,
      hardCeilingSeconds: 300,
    })
    expect(result.scope).toMatchObject({
      branch: 'develop',
      sampleLimit: 3,
      recentCompletedRunHorizon: 4,
      medianThresholdSeconds: 120,
      hardCeilingSeconds: 300,
    })
    expect(result.jobs.map((job) => job.key)).toEqual(['CI / test'])
  })

  it('sorts same-named workflows by id', async () => {
    const order: number[] = []
    const execute: GhApiExecutor = async (request) => {
      if (request.endpoint.includes('/actions/workflows?')) {
        return {
          workflows: [
            { id: 2, name: 'CI', state: 'active' },
            { id: 1, name: 'CI', state: 'active' },
          ],
        }
      }
      const workflowId = Number(request.endpoint.match(/\/actions\/workflows\/(\d+)\/runs/)?.[1])
      if (workflowId) {
        order.push(workflowId)
        return { workflow_runs: [makeRun(workflowId, 'CI', 'pull_request')] }
      }
      return { jobs: [makeJob(1, 'test', 100)] }
    }

    await audit(execute)
    expect(order).toEqual([1, 2])
  })
})
