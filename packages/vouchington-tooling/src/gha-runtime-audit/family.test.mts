import { describe, expect, it } from 'vitest'

import { auditCiJobRuntime } from './audit.mts'
import { makeExecutor, makeJob, makeRun, type FixtureJob } from './index.test-helpers.mts'
import { resolveRuntimeAuditOptions, type RuntimeAuditOptions } from './scope.mts'

const workflows: RuntimeAuditOptions['workflows'] = [{ name: 'CI', event: 'pull_request' }]

function step(name: string, seconds: number, start = '2026-01-01T00:00:00.000Z') {
  const started = new Date(start)
  return {
    name,
    started_at: started.toISOString(),
    completed_at: new Date(started.getTime() + seconds * 1000).toISOString(),
  }
}

function shard(
  runId: number,
  name: string,
  seconds: number,
  steps?: FixtureJob['steps'],
): FixtureJob {
  return {
    ...makeJob(runId, name, seconds),
    id: runId * 100 + name.length + seconds,
    ...(steps === undefined ? {} : { steps }),
  }
}

function audit(
  jobs: FixtureJob[],
  options: Partial<RuntimeAuditOptions> = {},
): ReturnType<typeof auditCiJobRuntime> {
  return auditCiJobRuntime(makeExecutor([makeRun(1, 'CI', 'pull_request')], { 1: jobs }), {
    repository: 'owner/repo',
    workflows,
    ...options,
  })
}

describe('gha-runtime-audit job families', () => {
  it('reports sharded families below the floor and keeps per-job rows', async () => {
    const result = await audit(
      [
        shard(1, 'backend (1, linux)', 200, [
          { name: 'skipped', started_at: null, completed_at: null },
          step('Run actions/checkout@v4', 60),
          step('Run vitest', 140, '2026-01-01T00:01:00.000Z'),
        ]),
        shard(1, 'backend (2, linux)', 220, [
          step('Run actions/checkout@v4', 60),
          step('Run vitest', 160, '2026-01-01T00:01:00.000Z'),
        ]),
        shard(1, 'api (1)', 100),
        shard(1, 'api (2)', 200),
        shard(1, 'api (3)', 300),
        shard(1, 'web (1)', 400, [step('Run vitest', 10)]),
        shard(1, 'web (2)', 500, [step('Run vitest', 10)]),
        shard(1, 'lint', 30),
        shard(1, 'only (1)', 40),
      ],
      { medianFloorSeconds: 300 },
    )

    expect(result.scope.medianFloorSeconds).toBe(300)
    expect(result.jobs.map((job) => job.key)).toEqual([
      'CI / api',
      'CI / api (1)',
      'CI / api (2)',
      'CI / api (3)',
      'CI / backend',
      'CI / backend (1, linux)',
      'CI / backend (2, linux)',
      'CI / lint',
      'CI / only (1)',
      'CI / web',
      'CI / web (1)',
      'CI / web (2)',
    ])
    expect(result.violations.map((job) => job.key)).toEqual(['CI / backend', 'CI / api'])
    expect(result.violations[0]).toMatchObject({
      reasons: ['family-median-below-floor'],
      medianSeconds: 210,
      shardCount: 2,
      suggestedShardCount: 1,
      sampleCount: 2,
    })
    expect(result.violations[0]?.setupShare).toBeCloseTo(120 / 420)
    expect(result.violations[1]).toMatchObject({
      reasons: ['family-median-below-floor'],
      medianSeconds: 200,
      shardCount: 3,
      suggestedShardCount: 2,
      setupShare: null,
    })
    expect(result.jobs.find((job) => job.key === 'CI / web')).toMatchObject({
      reasons: [],
      medianSeconds: 450,
      shardCount: 2,
      setupShare: 0,
    })
    expect(result.jobs.find((job) => job.key === 'CI / web')?.suggestedShardCount).toBeUndefined()
    expect(result.jobs.find((job) => job.key === 'CI / lint')?.shardCount).toBeUndefined()
  })

  it('does not add family rows when the floor is off', async () => {
    const result = await audit([shard(1, 'backend (1)', 120), shard(1, 'backend (2)', 180)])

    expect(result.scope.medianFloorSeconds).toBeNull()
    expect(result.jobs.map((job) => job.key)).toEqual(['CI / backend (1)', 'CI / backend (2)'])
    expect(result.violations).toEqual([])
  })

  it('rejects a non-positive ceiling or a floor that is not below it', () => {
    const options = { repository: 'owner/repo', workflows }
    expect(() => resolveRuntimeAuditOptions({ ...options, medianFloorSeconds: 1.5 })).toThrow(
      'median floor must be a positive integer',
    )
    expect(() => resolveRuntimeAuditOptions({ ...options, medianFloorSeconds: 0 })).toThrow(
      'median floor must be a positive integer',
    )
    expect(() => resolveRuntimeAuditOptions({ ...options, medianThresholdSeconds: 1.5 })).toThrow(
      'median ceiling must be a positive integer',
    )
    expect(() => resolveRuntimeAuditOptions({ ...options, medianThresholdSeconds: 0 })).toThrow(
      'median ceiling must be a positive integer',
    )
    expect(() => resolveRuntimeAuditOptions({ ...options, medianFloorSeconds: 360 })).toThrow(
      'median floor must be below the median ceiling',
    )
    expect(() =>
      resolveRuntimeAuditOptions({
        ...options,
        medianFloorSeconds: 120,
        medianThresholdSeconds: 120,
      }),
    ).toThrow('median floor must be below the median ceiling')
    expect(
      resolveRuntimeAuditOptions({
        ...options,
        medianFloorSeconds: 120,
        medianThresholdSeconds: 240,
      }).medianFloorSeconds,
    ).toBe(120)
  })
})
