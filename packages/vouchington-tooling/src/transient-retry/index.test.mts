import { describe, expect, it } from 'vitest'

import { decide, deriveRetryAttempt, type RetryContext, type RetryRule } from './index.mts'

const context = (targetNames: readonly string[] = ['worker-1']): RetryContext => ({
  runAttempt: 1,
  targetNames: new Set(targetNames),
})

const rerun = (overrides: Partial<RetryRule> = {}): RetryRule =>
  ({
    id: 'transient-network',
    maxAttempts: 3,
    match: () => true,
    retryTarget: { targetName: 'worker-1' },
    ...overrides,
  }) as RetryRule

describe('deriveRetryAttempt', () => {
  it('discounts only prior attempts with no resolved targets', () => {
    expect(deriveRetryAttempt(5, [2, 0, 0, 3])).toBe(3)
    expect(deriveRetryAttempt(1, [])).toBe(1)
    expect(deriveRetryAttempt(2, [0, 0])).toBe(1)
  })
})

describe('decide', () => {
  it('evaluates rules in declaration order and returns the first match', async () => {
    const evaluated: string[] = []
    const result = await decide(context(), [
      rerun({
        id: 'first',
        match: () => {
          evaluated.push('first')
          return false
        },
      }),
      rerun({
        id: 'second',
        match: () => {
          evaluated.push('second')
          return true
        },
      }),
      rerun({ id: 'third' }),
    ])
    expect(evaluated).toEqual(['first', 'second'])
    expect(result).toEqual({ decision: 'rerun', matchedRule: 'second', targetName: 'worker-1' })
  })

  it('uses per-rule attempts for reruns and shared attempts for non-rerun decisions', async () => {
    const retryAttempts = new Map([['retry', 3]])
    await expect(
      decide({ ...context(), runAttempt: 5, retryAttempt: 1, retryAttempts }, [
        rerun({ id: 'retry', maxAttempts: 3 }),
      ]),
    ).resolves.toMatchObject({ decision: 'rerun', matchedRule: 'retry' })
    await expect(
      decide({ ...context(), runAttempt: 1 }, [
        { id: 'plan', maxAttempts: 3, decision: 'fresh-plan', match: () => true },
      ]),
    ).resolves.toEqual({ decision: 'fresh-plan', matchedRule: 'plan' })
    await expect(
      decide({ ...context(), runAttempt: 5, retryAttempt: 5 }, [
        { id: 'plan', maxAttempts: 3, decision: 'fresh-plan', match: () => true },
      ]),
    ).resolves.toEqual({ decision: 'no-match', matchedRule: '', reason: 'no-rule' })
  })

  it('returns a provider-neutral no-match when no rule matches or max attempts are exhausted', async () => {
    await expect(decide(context(), [rerun({ match: () => false })])).resolves.toEqual({
      decision: 'no-match',
      matchedRule: '',
      reason: 'no-rule',
    })
    await expect(
      decide({ ...context(), retryAttempt: 4 }, [rerun({ maxAttempts: 3 })]),
    ).resolves.toEqual({ decision: 'no-match', matchedRule: '', reason: 'no-rule' })
  })

  it('fails closed when either attempt count is invalid', async () => {
    await expect(decide(context(), [rerun({ maxAttempts: Number.NaN })])).resolves.toEqual({
      decision: 'no-match',
      matchedRule: 'transient-network',
      reason: 'invalid-rule',
    })
    await expect(decide({ ...context(), retryAttempt: Number.NaN }, [rerun()])).resolves.toEqual({
      decision: 'no-match',
      matchedRule: 'transient-network',
      reason: 'invalid-rule',
    })
  })

  it('fails closed when an exact target is missing from provider resolution', async () => {
    await expect(decide(context(['other']), [rerun()])).resolves.toEqual({
      decision: 'no-match',
      matchedRule: 'transient-network',
      reason: 'missing-target',
    })
    await expect(decide({ runAttempt: 1 }, [rerun()])).resolves.toMatchObject({
      decision: 'no-match',
      reason: 'missing-target',
    })
  })

  it('resolves a target family only when the resolver returns a member of that family', async () => {
    const familyRule = rerun({
      id: 'matrix',
      retryTarget: {
        targetFamily: 'browser-',
        resolveTargetName: () => 'browser-2',
      },
    })
    await expect(decide(context(['browser-1', 'browser-2']), [familyRule])).resolves.toEqual({
      decision: 'rerun',
      matchedRule: 'matrix',
      targetName: 'browser-2',
    })
    await expect(
      decide(context(['browser-1']), [
        rerun({
          id: 'missing-family-target',
          retryTarget: { targetFamily: 'browser-', resolveTargetName: () => null },
        }),
      ]),
    ).resolves.toEqual({
      decision: 'no-match',
      matchedRule: 'missing-family-target',
      reason: 'missing-target',
    })
    await expect(
      decide(context(['browser-1']), [
        rerun({
          id: 'wrong-family-target',
          retryTarget: { targetFamily: 'browser-', resolveTargetName: () => 'worker-1' },
        }),
      ]),
    ).resolves.toEqual({
      decision: 'no-match',
      matchedRule: 'wrong-family-target',
      reason: 'invalid-target',
    })
  })

  it('does not expose provider dispatch for a matched rerun without a target', async () => {
    await expect(
      decide(context(), [
        {
          id: 'unsafe',
          maxAttempts: 1,
          match: () => true,
          retryTarget: undefined,
        } as unknown as RetryRule,
      ]),
    ).resolves.toEqual({ decision: 'no-match', matchedRule: 'unsafe', reason: 'invalid-target' })
  })

  it('fails closed when target resolution throws or returns malformed values', async () => {
    await expect(
      decide(context(['worker-1']), [
        rerun({
          id: 'throws',
          retryTarget: {
            targetFamily: 'worker-',
            resolveTargetName: () => {
              throw new Error('provider lookup failed')
            },
          },
        }),
      ]),
    ).resolves.toEqual({ decision: 'no-match', matchedRule: 'throws', reason: 'invalid-target' })
    await expect(
      decide(context(['worker-1']), [
        rerun({
          id: 'malformed',
          retryTarget: { targetFamily: undefined, resolveTargetName: () => 'worker-1' } as never,
        }),
      ]),
    ).resolves.toEqual({ decision: 'no-match', matchedRule: 'malformed', reason: 'invalid-target' })
    await expect(
      decide(context(['worker-1']), [
        rerun({
          id: 'non-string',
          retryTarget: { resolveTargetName: () => 42 } as never,
        }),
      ]),
    ).resolves.toEqual({
      decision: 'no-match',
      matchedRule: 'non-string',
      reason: 'invalid-target',
    })
    await expect(
      decide(context(['worker-1']), [
        rerun({
          id: 'empty-target',
          retryTarget: { resolveTargetName: () => '' } as never,
        }),
      ]),
    ).resolves.toEqual({
      decision: 'no-match',
      matchedRule: 'empty-target',
      reason: 'missing-target',
    })
  })

  it('runs the post-evaluation hook for matched and non-matched rules', async () => {
    const seen: string[] = []
    await decide(context(), [rerun({ id: 'miss', match: () => false }), rerun({ id: 'hit' })], {
      afterRuleEvaluated: (_, rule) => {
        seen.push(rule.id)
      },
    })
    expect(seen).toEqual(['miss', 'hit'])
  })
})
