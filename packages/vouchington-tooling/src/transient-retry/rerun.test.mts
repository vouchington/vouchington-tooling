import { afterEach, describe, expect, it, vi } from 'vitest'

import { NO_RERUN, RERUN_REQUESTED, rerunKnownTransient } from './rerun.mts'
import type { WorkflowRetryRule } from './run-context-types.mts'
import {
  createFakeEnv,
  installFakeGh,
  jobsPage,
  runReply,
  type Route,
} from './run-context.test-helpers.mts'

const SECRET = 'ghp_supersecretvalue'

const failedRun: Route[] = [
  ['run rerun --repo', ''],
  ['actions/runs/123/jobs', jobsPage({ name: 'test', id: 11, conclusion: 'failure' })],
  ['actions/runs/123', runReply()],
]

const logs = { '/jobs/11/logs': `token=${SECRET}\nECONNRESET while fetching` }

const logRule: WorkflowRetryRule = {
  id: 'network',
  maxAttempts: 2,
  match: async (context) =>
    [...(await context.failedJobLogs()).values()].some((log) => log.includes('ECONNRESET')),
}

function run(options: Partial<Parameters<typeof rerunKnownTransient>[0]>, routes = failedRun) {
  const fake = createFakeEnv(routes, logs)
  const lines: string[] = []
  const result = rerunKnownTransient({
    repository: 'acme/widgets',
    runId: '123',
    rules: [logRule],
    api: fake.api,
    streamLog: fake.env.streamLog,
    log: (line) => lines.push(line),
    ...options,
  })
  return { ...fake, lines, result }
}

describe('rerunKnownTransient', () => {
  it('reruns a failed run when an injected rule matches, without printing log text', async () => {
    const { calls, lines, result } = run({})
    await expect(result).resolves.toBe(RERUN_REQUESTED)
    expect(calls.at(-1)).toEqual(['run', 'rerun', '--repo', 'acme/widgets', '123'])
    expect(lines).toEqual([
      'Workflow: CI',
      'Conclusion: failure',
      'Run attempt: 1 (retry attempt: 1)',
      'Failed jobs: test',
      'Decision: rerun (rule network)',
      'Requested rerun for run 123.',
    ])
    expect(lines.join('\n')).not.toContain(SECRET)
  })

  it('does not rerun on a dry run', async () => {
    const { calls, lines, result } = run({ dryRun: true })
    await expect(result).resolves.toBe(RERUN_REQUESTED)
    expect(calls.every((args) => args[0] !== 'run')).toBe(true)
    expect(lines.at(-1)).toBe('Dry run: would run gh run rerun --repo acme/widgets 123')
  })

  it('requests nothing when no rule matches', async () => {
    const { calls, lines, result } = run({ rules: [] })
    await expect(result).resolves.toBe(NO_RERUN)
    expect(calls.every((args) => args[0] !== 'run')).toBe(true)
    expect(lines.slice(-2)).toEqual([
      'Decision: dispatch',
      "No rerun requested: decision is 'dispatch', not 'rerun'.",
    ])
  })

  it('requests nothing for a run that did not fail', async () => {
    const routes: Route[] = [['actions/runs/123', runReply({ conclusion: null })]]
    const { lines, result } = run({}, routes)
    await expect(result).resolves.toBe(NO_RERUN)
    expect(lines).toEqual([
      'Workflow: CI',
      'Conclusion: (none)',
      'Run conclusion is not failure, timed_out, or cancelled; no rerun requested.',
    ])
  })

  it('reports when a failed run has no failed jobs', async () => {
    const routes: Route[] = [
      ['actions/runs/123/jobs', jobsPage()],
      ['actions/runs/123', runReply({ conclusion: 'cancelled' })],
    ]
    const { lines, result } = run({ rules: [] }, routes)
    await expect(result).resolves.toBe(NO_RERUN)
    expect(lines).toContain('Failed jobs: (none)')
  })

  it('applies caller-supplied log limits', async () => {
    const { result, streamed } = run({ limits: { totalBytes: 0 }, rules: [logRule] })
    await expect(result).resolves.toBe(NO_RERUN)
    expect(streamed).toEqual([])
  })

  it('infers the repository from the checkout', async () => {
    const routes: Route[] = [['repo view', 'acme/widgets\n'], ...failedRun]
    const { calls, result } = run({ repository: undefined as never }, routes)
    await expect(result).resolves.toBe(RERUN_REQUESTED)
    expect(calls[0]).toEqual(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'])
  })

  it.each([new Error('not a repo'), '  \n'])('fails when inference yields %s', async (reply) => {
    const routes: Route[] = [['repo view', reply as string], ...failedRun]
    await expect(run({ repository: undefined as never }, routes).result).rejects.toThrow(
      'Missing repository. Pass --repo owner/name',
    )
  })
})

describe('rerunKnownTransient with the real gh defaults', () => {
  let restore: (() => void) | undefined
  afterEach(() => {
    restore?.()
    vi.restoreAllMocks()
  })

  it('fetches, streams and logs through gh, stdout and the default retrying client', async () => {
    restore = installFakeGh(`
case "$*" in
  "api repos/acme/widgets/actions/runs/9")
    echo '{"conclusion":"failure","name":"CI","run_attempt":1}' ;;
  "api repos/acme/widgets/actions/runs/9/jobs --paginate --slurp")
    echo '[{"jobs":[{"name":"test","id":5,"conclusion":"failure"}]}]' ;;
  "api --allow-escape-sequences repos/acme/widgets/actions/jobs/5/logs")
    echo "ECONNRESET ${SECRET}" ;;
  "run rerun --repo acme/widgets 9") echo rerun ;;
  *) echo "unexpected: $*" >&2; exit 1 ;;
esac`)
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await expect(
      rerunKnownTransient({ repository: 'acme/widgets', runId: '9', rules: [logRule] }),
    ).resolves.toBe(RERUN_REQUESTED)

    expect(log).toHaveBeenCalledWith('Requested rerun for run 9.')
    expect(log.mock.calls.flat().join('\n')).not.toContain(SECRET)
  })
})
