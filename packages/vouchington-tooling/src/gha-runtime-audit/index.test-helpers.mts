import type { GhApiExecutor } from './model.mts'
import type { RuntimeAuditOptions } from './scope.mts'

export type FixtureJob = {
  id: number
  name: string
  started_at: string
  completed_at: string
  conclusion: 'success' | 'failure'
  html_url: string
}

export const exampleAuditOptions: Omit<RuntimeAuditOptions, 'repository'> = {
  workflows: [
    { name: 'CI', event: 'pull_request' },
    { name: /^Main CI \(.+\)$/, event: 'push' },
  ],
}

export function makeJob(
  runId: number,
  name: string,
  seconds: number,
  queueMinutes = 0,
  conclusion: FixtureJob['conclusion'] = 'success',
): FixtureJob {
  const started = new Date(Date.UTC(2026, 0, runId, 0, queueMinutes))
  return {
    id: runId * 10,
    name,
    started_at: started.toISOString(),
    completed_at: new Date(started.getTime() + seconds * 1000).toISOString(),
    conclusion,
    html_url: `https://github.test/jobs/${runId}`,
  }
}

export function makeExecutor(
  runs: unknown[],
  jobsByRun: Readonly<Record<number, FixtureJob[]>>,
): GhApiExecutor {
  return async (request) => {
    const { endpoint } = request
    if (endpoint.includes('/actions/workflows?')) {
      return {
        workflows: endpoint.includes('page=1')
          ? [
              { id: 1, name: 'CI', state: 'active' },
              { id: 2, name: 'Main CI (web)', state: 'active' },
              { id: 3, name: 'Other', state: 'active' },
            ]
          : [],
      }
    }
    if (endpoint.includes('/actions/workflows/1/runs?')) {
      return {
        workflow_runs: endpoint.includes('page=1')
          ? runs.filter((run) => (run as { name?: string }).name === 'CI')
          : [],
      }
    }
    if (endpoint.includes('/actions/workflows/2/runs?')) {
      return {
        workflow_runs: endpoint.includes('page=1')
          ? runs.filter((run) => (run as { name?: string }).name === 'Main CI (web)')
          : [],
      }
    }
    const match = endpoint.match(/\/actions\/runs\/(\d+)\/jobs/)
    if (!match) throw new Error(`Unexpected endpoint: ${endpoint}`)
    return { jobs: jobsByRun[Number(match[1])] }
  }
}

export function makeRun(
  id: number,
  name: string,
  event: 'pull_request' | 'push',
  branch = 'main',
  conclusion = 'success',
  createdAt = new Date(Date.UTC(2026, 0, id)).toISOString(),
  headBranch: string | null = branch,
): unknown {
  return {
    id,
    name,
    event,
    conclusion,
    created_at: createdAt,
    html_url: `https://github.test/runs/${id}`,
    head_branch: headBranch,
    pull_requests: event === 'pull_request' ? [{ base: { ref: branch } }] : [],
  }
}
