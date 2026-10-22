import { describe, expect, it } from 'vitest'

import { annotationMessagesFromPages } from './run-context-annotations.mts'
import { fetchWorkflowRunSummary, parseWorkflowJobEntries } from './run-context-jobs.mts'
import { buildWorkflowRunContext } from './run-context.mts'
import { createFakeEnv, jobsPage, runReply, type Route } from './run-context.test-helpers.mts'
import { LOG_OMISSION_MARKER } from './log-window.mts'

describe('fetchWorkflowRunSummary', () => {
  it('fetches and validates run metadata', async () => {
    const { env, calls } = createFakeEnv([['runs/123', runReply({ run_attempt: 2, name: 'Web' })]])
    await expect(fetchWorkflowRunSummary(env)).resolves.toEqual({
      conclusion: 'failure',
      runAttempt: 2,
      workflowName: 'Web',
    })
    expect(calls).toEqual([['api', 'repos/acme/widgets/actions/runs/123']])
  })

  it('allows a run with no conclusion yet', async () => {
    const { env } = createFakeEnv([['runs/123', runReply({ conclusion: null })]])
    await expect(fetchWorkflowRunSummary(env)).resolves.toMatchObject({ conclusion: null })
  })

  it.each([
    ['null', 'response'],
    [runReply({ run_attempt: 0 }), 'attempt'],
    [runReply({ run_attempt: 1.5 }), 'attempt'],
    [runReply({ run_attempt: '1' }), 'attempt'],
    [runReply({ name: '' }), 'name'],
    [runReply({ name: 7 }), 'name'],
    [runReply({ conclusion: 5 }), 'conclusion'],
  ])('rejects invalid metadata %s', async (reply, what) => {
    const { env } = createFakeEnv([['runs/123', reply]])
    await expect(fetchWorkflowRunSummary(env)).rejects.toThrow(
      `Invalid workflow run ${what} in GitHub API response for run 123`,
    )
  })
})

describe('parseWorkflowJobEntries', () => {
  it('flattens pages and tolerates a page with no jobs', () => {
    expect(parseWorkflowJobEntries('[{"jobs":[{"name":"a","id":1}]},{}]')).toEqual([
      { name: 'a', id: 1 },
    ])
  })
})

describe('annotationMessagesFromPages', () => {
  it('keeps only string messages from well-formed pages', () => {
    expect(
      annotationMessagesFromPages(
        JSON.stringify([[{ message: 'a' }, { message: 1 }, null, 'x'], 'not-a-page']),
      ),
    ).toEqual(['a'])
    expect(annotationMessagesFromPages('{}')).toEqual([])
  })
})

const currentJobs = jobsPage(
  { name: 'build', id: 10, conclusion: 'success' },
  {
    name: 'test',
    id: 11,
    conclusion: 'failure',
    steps: [{ name: 'Run tests', number: 3, status: 'completed' }],
  },
)

const baseRoutes: Route[] = [
  ['attempts/1/jobs', jobsPage()],
  ['runs/123/jobs', currentJobs],
  ['check-runs/11/annotations', JSON.stringify([[{ message: 'runner lost communication' }]])],
]

const options = { conclusion: 'failure', runAttempt: 2, workflowName: 'Web' } as const

describe('buildWorkflowRunContext', () => {
  it('maps job state onto the retry context and fetches evidence lazily', async () => {
    const { env, calls, streamed } = createFakeEnv(baseRoutes, {
      '/jobs/11/logs': 'test failed with a transient error',
      '/jobs/10/logs': 'build ok',
    })

    const context = await buildWorkflowRunContext(env, options)

    expect(context).toMatchObject({
      runAttempt: 2,
      retryAttempt: 1,
      jobNames: ['build', 'test'],
      failedJobNames: ['test'],
      targetNames: new Set(['build', 'test']),
    })
    expect(context.jobConclusions.get('build')).toBe('success')
    expect(context.jobSteps.get('test')).toEqual([
      { name: 'Run tests', number: 3, status: 'completed' },
    ])
    expect(context.jobSteps.get('build')).toEqual([])
    expect(context.retryAttempts).toBeUndefined()
    expect(streamed).toEqual([])
    expect(calls.some((args) => args.join(' ').includes('annotations'))).toBe(false)

    const failed = new Map([['test', 'test failed with a transient error']])
    await expect(context.failedJobLogs()).resolves.toEqual(failed)
    await expect(context.jobLogs(['build', 'test', 'missing'])).resolves.toEqual(
      new Map([['build', 'build ok'], ...failed, ['missing', '']]),
    )
    expect(streamed).toEqual([
      'repos/acme/widgets/actions/jobs/11/logs',
      'repos/acme/widgets/actions/jobs/10/logs',
    ])
    await expect(context.failedJobLogFetchFailures()).resolves.toEqual(new Set())
  })

  it('caches annotations and records fetch failures per job', async () => {
    const { env, calls } = createFakeEnv(baseRoutes)
    const context = await buildWorkflowRunContext(env, options)

    await expect(context.failedJobAnnotations('test')).resolves.toEqual([
      'runner lost communication',
    ])
    await context.failedJobAnnotations('test')
    await expect(context.failedJobAnnotations('build')).resolves.toEqual([])
    expect(calls.filter((args) => args.join(' ').includes('annotations'))).toHaveLength(1)
    await expect(context.failedJobAnnotationFetchFailures()).resolves.toEqual(new Set())

    const broken = createFakeEnv([
      ['runs/123/jobs', currentJobs],
      ['check-runs/11/annotations', new Error('HTTP 500')],
    ])
    const brokenContext = await buildWorkflowRunContext(broken.env, { ...options, runAttempt: 1 })
    await expect(brokenContext.failedJobAnnotations('test')).resolves.toEqual([])
    await expect(brokenContext.failedJobAnnotationFetchFailures()).resolves.toEqual(
      new Set(['test']),
    )
  })

  it('shares one in-flight stream between concurrent readers', async () => {
    const { env, streamed } = createFakeEnv(baseRoutes, { '/jobs/11/logs': 'once' })
    const context = await buildWorkflowRunContext(env, options)
    await Promise.all([context.failedJobLogs(), context.jobLogs(['test']), context.failedJobLogs()])
    expect(streamed).toHaveLength(1)
  })

  it('records an unreadable log as a failure with empty text and retries transport errors', async () => {
    const fatal = createFakeEnv(baseRoutes, { '/jobs/11/logs': new Error('HTTP 404') })
    const context = await buildWorkflowRunContext(fatal.env, options)
    await expect(context.failedJobLogs()).resolves.toEqual(new Map([['test', '']]))
    await expect(context.failedJobLogFetchFailures()).resolves.toEqual(new Set(['test']))
    expect(fatal.streamed).toHaveLength(1)

    const exhausted = createFakeEnv(baseRoutes, { '/jobs/11/logs': new Error('ECONNRESET') })
    const retried = await buildWorkflowRunContext(exhausted.env, options)
    await expect(retried.failedJobLogs()).resolves.toEqual(new Map([['test', '']]))
    expect(exhausted.streamed).toHaveLength(3)
  })

  it('bounds retained log text across the run and fails jobs past the budget', async () => {
    const routes: Route[] = [
      ['attempts/1/jobs', jobsPage()],
      [
        'runs/123/jobs',
        jobsPage(
          { name: 'a', id: 1, conclusion: 'failure' },
          { name: 'b', id: 2, conclusion: 'cancelled' },
        ),
      ],
    ]
    const { env } = createFakeEnv(
      routes,
      { '/jobs/1/logs': 'x'.repeat(2000), '/jobs/2/logs': 'never read' },
      { totalBytes: LOG_OMISSION_MARKER.length + 90 },
    )
    const context = await buildWorkflowRunContext(env, { ...options, conclusion: 'cancelled' })

    const logs = await context.failedJobLogs()

    expect(Buffer.byteLength(logs.get('a')!)).toBeLessThanOrEqual(LOG_OMISSION_MARKER.length + 90)
    expect(logs.get('a')).toContain(LOG_OMISSION_MARKER.trim())
    expect(logs.get('b')).toBe('')
    await expect(context.failedJobLogFetchFailures()).resolves.toEqual(new Set(['b']))
  })

  it('falls back to the provider attempt when a prior attempt cannot be read', async () => {
    const { env } = createFakeEnv([
      ['attempts/1/jobs', new Error('HTTP 500')],
      ['runs/123/jobs', currentJobs],
    ])
    const context = await buildWorkflowRunContext(env, { ...options, rules: [] })
    expect(context.retryAttempt).toBe(2)
    expect(context.retryAttempts).toBeUndefined()
  })

  it('discounts prior attempts that created no jobs and replays rules over the rest', async () => {
    const { env } = createFakeEnv([
      ['attempts/1/jobs', jobsPage()],
      ['attempts/2/jobs', jobsPage({ name: 'test', id: 5, conclusion: 'failure' })],
      ['runs/123/jobs', currentJobs],
    ])
    const rule = {
      id: 'always',
      maxAttempts: 3,
      match: (context: { failedJobNames: readonly string[] }) =>
        context.failedJobNames.includes('test'),
    }
    const context = await buildWorkflowRunContext(env, {
      ...options,
      runAttempt: 3,
      rules: [rule],
    })
    expect(context.retryAttempt).toBe(2)
    expect(context.retryAttempts).toEqual(new Map([['always', 2]]))
  })

  it('keeps the shared attempt when replaying the first rule throws', async () => {
    const { env } = createFakeEnv(baseRoutes)
    const context = await buildWorkflowRunContext(env, {
      ...options,
      rules: [{ id: 'bad', maxAttempts: 3, match: () => Promise.reject(new Error('boom')) }],
    })
    expect(context.retryAttempts).toBeUndefined()
    expect(context.retryAttempt).toBe(1)
  })
})
