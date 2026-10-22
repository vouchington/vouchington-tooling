import { describe, expect, it } from 'vitest'

import { deriveRuleAttempts } from './run-context-rule-attempts.mts'
import type { WorkflowRetryRule, WorkflowRunContext } from './run-context-types.mts'
import { createFakeEnv, jobsPage, type LogReply, type Route } from './run-context.test-helpers.mts'

const failed = (conclusion: string, id = 5) => ({ name: 'test', id, conclusion })

const rule = (
  id: string,
  match: (context: WorkflowRunContext) => boolean | Promise<boolean>,
  extra: Partial<WorkflowRetryRule> = {},
): WorkflowRetryRule => ({ id, maxAttempts: 9, match, ...extra }) as WorkflowRetryRule

const derive = (
  routes: Route[],
  rules: WorkflowRetryRule[],
  runAttempt: number,
  logs: Record<string, LogReply> = {},
  priorCounts: number[] = [],
) => {
  const { env } = createFakeEnv(routes, logs)
  return deriveRuleAttempts(env, { priorCounts, rules, runAttempt, workflowName: 'Web' })
}

describe('deriveRuleAttempts', () => {
  it('counts each prior attempt a rerun rule won', async () => {
    const routes: Route[] = [
      ['attempts/1/jobs', jobsPage(failed('failure'))],
      ['attempts/2/jobs', jobsPage(failed('timed_out'))],
      ['attempts/3/jobs', jobsPage(failed('cancelled'))],
    ]
    const conclusions: string[] = []
    const rules = [
      rule('never', () => false),
      rule('timeouts', (context) => {
        conclusions.push(context.conclusion)
        return context.conclusion !== 'failure'
      }),
      rule('catch-all', () => true),
    ]
    const attempts = await derive(routes, rules, 4, {}, [1, 1, 1])
    expect(attempts).toEqual(
      new Map([
        ['never', 1],
        ['timeouts', 3],
        ['catch-all', 2],
      ]),
    )
    expect(conclusions).toEqual(['failure', 'timed_out', 'cancelled'])
  })

  it('does not count non-rerun decisions or rules past their maximum', async () => {
    const routes: Route[] = [
      ['attempts/1/jobs', jobsPage(failed('failure'))],
      ['attempts/2/jobs', jobsPage(failed('failure'))],
    ]
    const rules = [
      rule('capped', () => true, { maxAttempts: 1 }),
      rule('ignored', () => true, { decision: 'ignore' }),
    ]
    const attempts = await derive(routes, rules, 3, {}, [1, 1])
    expect(attempts).toEqual(
      new Map([
        ['ignored', 1],
        ['capped', 2],
      ]),
    )
  })

  it('drops a rule, and those after it, whose log evidence is unreadable', async () => {
    const routes: Route[] = [['attempts/1/jobs', jobsPage(failed('failure'))]]
    const readsLogs = async (context: WorkflowRunContext) =>
      (await context.failedJobLogs()).get('test') === 'x'
    const rules = [
      rule('plain', () => false),
      rule('needs-logs', readsLogs),
      rule('after', () => true),
    ]
    const attempts = await derive(routes, rules, 2, { '/jobs/5/logs': new Error('HTTP 404') })
    expect(attempts).toEqual(new Map([['plain', 1]]))
  })

  it('drops a rule whose annotation evidence is unreadable', async () => {
    const routes: Route[] = [
      ['attempts/1/jobs', jobsPage(failed('failure'))],
      ['annotations', new Error('HTTP 500')],
    ]
    const rules = [
      rule('plain', () => false),
      rule(
        'needs-annotations',
        async (context) => (await context.failedJobAnnotations('test')).length > 0,
      ),
    ]
    await expect(derive(routes, rules, 2)).resolves.toEqual(new Map([['plain', 1]]))
  })

  it('throws when the first rule cannot be replayed', async () => {
    const routes: Route[] = [['attempts/1/jobs', jobsPage(failed('failure'))]]
    const rules = [rule('first', async (context) => (await context.failedJobLogs()).size === 0)]
    await expect(
      derive(routes, rules, 2, { '/jobs/5/logs': new Error('HTTP 404') }),
    ).rejects.toThrow('Cannot replay rule first: required prior-attempt evidence is unavailable')
  })

  it('propagates rule errors and job fetch errors', async () => {
    const routes: Route[] = [['attempts/1/jobs', jobsPage(failed('failure'))]]
    await expect(
      derive(routes, [rule('bad', () => Promise.reject(new Error('boom')))], 2),
    ).rejects.toThrow('boom')
    await expect(
      derive([['attempts/1/jobs', new Error('HTTP 500')]], [rule('any', () => true)], 2),
    ).rejects.toThrow('HTTP 500')
  })

  it('returns one-based counts for a first attempt', async () => {
    await expect(derive([], [rule('a', () => true)], 1)).resolves.toEqual(new Map([['a', 1]]))
  })
})
