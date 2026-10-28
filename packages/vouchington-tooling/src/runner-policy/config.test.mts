import { describe, expect, it } from 'vitest'

import { parseRunnerPolicyConfig } from './config.mts'

describe('parseRunnerPolicyConfig', () => {
  it('applies defaults to a minimal config', () => {
    expect(parseRunnerPolicyConfig({ allowedLabels: ['a'] })).toEqual({
      allowedLabels: ['a'],
      requiredJobs: [],
      exactLabelJobs: [],
      restrictedLabels: [],
    })
  })

  it('parses a full config', () => {
    const full = {
      allowedLabels: ['a', 'b'],
      requiredJobs: [{ workflow: 'w.yml', job: 'j', runsOn: 'a' }],
      exactLabelJobs: [{ label: 'b', jobs: ['w.yml#j'] }],
      restrictedLabels: [
        { label: 'a', forbiddenActions: { prefixes: ['p/'], contains: ['/c/'], exact: ['x'] } },
        { label: 'b', forbidServices: false },
      ],
    }
    const parsed = parseRunnerPolicyConfig(full)
    expect(parsed.requiredJobs).toEqual(full.requiredJobs)
    expect(parsed.exactLabelJobs).toEqual(full.exactLabelJobs)
    expect(parsed.restrictedLabels).toEqual([
      {
        label: 'a',
        forbidServices: true,
        forbiddenActions: { prefixes: ['p/'], contains: ['/c/'], exact: ['x'] },
      },
      {
        label: 'b',
        forbidServices: false,
        forbiddenActions: { prefixes: [], contains: [], exact: [] },
      },
    ])
  })

  it.each([null, [], 'text', 3])('rejects a non-object config %j', (value) => {
    expect(() => parseRunnerPolicyConfig(value)).toThrow('must be a JSON object')
  })

  it('lists every problem at once', () => {
    const attempt = () =>
      parseRunnerPolicyConfig({
        allowedLabels: [],
        extra: 1,
        requiredJobs: [{ workflow: '', job: 'j', runsOn: 'a', more: true }, 'nope'],
        exactLabelJobs: [{ label: 'a', jobs: ['no-hash', 'w#j', 'w#j'], more: 1 }],
        restrictedLabels: [
          { label: 'a', forbidServices: 'yes', forbiddenActions: { prefixes: [1], other: [] } },
          { label: 'b', forbiddenActions: 'x' },
        ],
      })
    expect(attempt).toThrow(/invalid runner-policy config/)
    for (const fragment of [
      'config: unknown key "extra"',
      'allowedLabels: must be a non-empty array of non-empty strings',
      'requiredJobs[0]: unknown key "more"',
      'requiredJobs[0].workflow: must be a non-empty string',
      'requiredJobs[1]: must be an object',
      'exactLabelJobs[0].jobs: "no-hash" must look like workflow#job',
      'exactLabelJobs[0].jobs: entries must be unique',
      'exactLabelJobs[0]: unknown key "more"',
      'restrictedLabels[0].forbidServices: must be a boolean',
      'restrictedLabels[0].forbiddenActions: unknown key "other"',
      'restrictedLabels[0].forbiddenActions.prefixes: must be an array of non-empty strings',
      'restrictedLabels[1].forbiddenActions: must be an object',
    ]) {
      expect(attempt).toThrow(fragment)
    }
  })

  it('rejects sections that are not arrays', () => {
    expect(() => parseRunnerPolicyConfig({ allowedLabels: ['a'], requiredJobs: {} })).toThrow(
      'requiredJobs: must be an array',
    )
  })
})
