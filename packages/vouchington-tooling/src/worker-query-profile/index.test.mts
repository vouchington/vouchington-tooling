import type { TestJob } from 'glide-mq/testing'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createQueryProfiles, type WorkerQueryProfile } from '@vouchington/postgres/query-telemetry'
import {
  Queue,
  getTestWorkerProcessorDecorator,
  setTestWorkerProcessorDecorator,
} from '@vouchington/worker-runtime/testing'
import { createWorkerQueryProfileHelpers, workerQueryIdentities } from './index.mts'

function fixture() {
  const profiles = createQueryProfiles({ registryKey: Symbol() })
  const violations: string[] = []
  const lines: string[] = []
  const options = {
    profiles,
    recordViolation: (message: string) => {
      violations.push(message)
    },
    recordKind: 'test-worker',
    diagnosticsEnvVar: 'TEST_WORKER_DIAGNOSTICS',
    output: (line: string) => {
      lines.push(line)
    },
  }
  return { profiles, violations, lines, options, ...createWorkerQueryProfileHelpers(options) }
}

afterEach(() => {
  setTestWorkerProcessorDecorator(undefined)
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('worker query profile instrumentation', () => {
  it('profiles direct jobs inside caller wrappers and owns observers per worker', async () => {
    const f = fixture()
    const queue = new Queue<{ value: number }, number>(`profile-${crypto.randomUUID()}`)
    const calls: string[] = []
    const worker = new f.Worker(
      queue,
      (job: TestJob<{ value: number }, number>) => {
        calls.push('business')
        f.profiles.observe({ durationMs: 3, annotation: 'business' })
        return job.data.value
      },
      {
        wrapProcessor: (base, name) => {
          expect(name).toBe(queue.name)
          return (job) => {
            calls.push('caller')
            f.profiles.observe({ durationMs: 2, annotation: 'caller' })
            return base(job)
          }
        },
      },
    )
    const observed: WorkerQueryProfile[] = []
    const unsubscribe = worker.observeQueryProfiles((profile) => {
      observed.push(profile)
      return undefined
    })
    try {
      const job = await queue.add('owned', { value: 7 })
      expect((await queue.getJob(job!.id))?.returnvalue).toBe(7)
      expect(calls).toEqual(['caller', 'business'])
      expect(observed).toHaveLength(1)
      expect(observed[0]?.queries().map((query) => query.annotation)).toEqual([
        'caller',
        'business',
      ])
      expect(observed[0]?.identity.jobs).toEqual([{ id: job?.id, name: 'owned' }])
      unsubscribe()
      await queue.add('unsubscribed', { value: 8 })
      expect(observed).toHaveLength(1)
      expect(f.lines).toEqual([])
    } finally {
      await worker.close()
      await queue.close()
    }
  })

  it('reuses factory-decorated processors without duplicate profiles and survives module resets', async () => {
    const f = fixture()
    const stop = f.install()
    const processor = (job: { data: number }) => job.data
    const first = getTestWorkerProcessorDecorator()!(processor, 'shared') as (job: {
      id: string
      name: string
      data: number
    }) => Promise<number>
    vi.resetModules()
    const reloaded = await import('./index.mts')
    const other = reloaded.createWorkerQueryProfileHelpers(f.options)
    const { Queue: ReloadedQueue } = await import('@vouchington/worker-runtime/testing')
    const queue = new ReloadedQueue<number, number>(`shared-${crypto.randomUUID()}`)
    const a = new other.Worker(queue, first)
    const b = new other.Worker(queue, first)
    const seenA: WorkerQueryProfile[] = []
    const seenB: WorkerQueryProfile[] = []
    other.Worker.prototype.observeQueryProfiles.call(a, (profile) => {
      seenA.push(profile)
      return undefined
    })
    b.observeQueryProfiles((profile) => {
      seenB.push(profile)
      return undefined
    })
    try {
      await b.pause()
      const firstJob = await queue.add('one', 4)
      expect((await queue.getJob(firstJob!.id))?.returnvalue).toBe(4)
      expect(seenA.map((profile) => profile.identity.jobs[0]?.id)).toEqual([firstJob!.id])
      expect(seenB).toEqual([])
      await a.pause()
      await b.resume()
      const secondJob = await queue.add('two', 5)
      expect((await queue.getJob(secondJob!.id))?.returnvalue).toBe(5)
      expect(seenB.map((profile) => profile.identity.jobs[0]?.id)).toEqual([secondJob!.id])
      expect(seenA).toHaveLength(1)
      expect(seenA[0]?.workerProfiles()).toEqual([])
      expect(seenB[0]?.workerProfiles()).toEqual([])
    } finally {
      stop()
      await a.close()
      await b.close()
      await queue.close()
    }
  })

  it('rebuilds existing factory instrumentation outside a caller wrapper exactly once', async () => {
    const f = fixture()
    const owners: WorkerQueryProfile[] = []
    const original = f.wrapProcessor(
      () => 9,
      'queue',
      (profile) => {
        owners.push(profile)
        return undefined
      },
    )
    const queue = new Queue(`composed-${crypto.randomUUID()}`)
    const worker = new f.Worker(queue.name, original, {
      wrapProcessor: (base) => (job) => {
        f.profiles.observe({ durationMs: 1, annotation: 'configured' })
        return base(job)
      },
    })
    const seen: WorkerQueryProfile[] = []
    worker.observeQueryProfiles((profile) => {
      seen.push(profile)
      return undefined
    })
    try {
      const job = await queue.add('work', {})
      expect((await queue.getJob(job!.id))?.returnvalue).toBe(9)
      expect(seen).toHaveLength(1)
      expect(seen[0]?.queries().map((query) => query.annotation)).toEqual(['configured'])
      expect(seen[0]?.workerProfiles()).toEqual([])
      expect(owners).toEqual(seen)
    } finally {
      await worker.close()
      await queue.close()
    }
  })

  it('installs and restores the previous decorator without overwriting a later owner', async () => {
    const f = fixture()
    const previous = vi.fn((processor: unknown) => processor)
    setTestWorkerProcessorDecorator(previous)
    const restore = f.install()
    expect(getTestWorkerProcessorDecorator()).not.toBe(previous)
    const base = () => 11
    const installed = getTestWorkerProcessorDecorator()!(base, 'installed') as (
      input: unknown,
    ) => Promise<number>
    await expect(installed({ id: 'i', name: 'installation' })).resolves.toBe(11)
    expect(previous).toHaveBeenCalledWith(base, 'installed')
    restore()
    expect(getTestWorkerProcessorDecorator()).toBe(previous)
    const restoreAgain = f.install()
    setTestWorkerProcessorDecorator(previous)
    restoreAgain()
    expect(getTestWorkerProcessorDecorator()).toBe(previous)
  })

  it.each([false, true])(
    'shares repeated installs and releases them safely in either order: %s',
    async (reverse) => {
      const f = fixture()
      vi.stubEnv(f.options.diagnosticsEnvVar, '1')
      const first = f.install()
      const installed = getTestWorkerProcessorDecorator()
      const second = f.install()
      expect(getTestWorkerProcessorDecorator()).toBe(installed)
      const request = f.profiles.createRequestQueryProfile()
      const processor = installed!(() => 5, 'repeated') as (input: unknown) => Promise<number>
      await expect(request.run(() => processor({ id: 'r', name: 'repeat' }))).resolves.toBe(5)
      expect(request.workerProfiles()).toHaveLength(1)
      expect(request.workerProfiles()[0]?.workerProfiles()).toEqual([])
      expect(f.lines).toHaveLength(1)
      const cleanups = reverse ? [second, first] : [first, second]
      cleanups[0]!()
      cleanups[0]!()
      expect(getTestWorkerProcessorDecorator()).toBe(installed)
      cleanups[1]!()
      expect(getTestWorkerProcessorDecorator()).toBeUndefined()
    },
  )

  it.each([
    undefined,
    null,
    [],
    [{}],
    [{ id: '', name: 'job' }],
    [{ id: 'a', name: '' }],
    [{ id: 1, name: 'job' }],
    [{ id: 'a', name: 1 }],
    [{ id: 'a' }],
    [{ name: 'job' }],
    [{ id: 'a', name: 'job' }, null],
  ])('rejects invalid batch identities before business work: %j', async (input) => {
    const f = fixture()
    const business = vi.fn()
    await expect(f.wrapProcessor(business, 'queue')(input)).rejects.toThrow(
      'every batch member identity',
    )
    expect(business).not.toHaveBeenCalled()
  })

  it('accepts complete batches and injected identities and rejects non-function processors', async () => {
    const f = fixture()
    const batch = [
      { id: 'one', name: 'first' },
      { id: 'two', name: 'second' },
    ]
    const request = f.profiles.createRequestQueryProfile()
    await expect(request.run(() => f.wrapProcessor(() => [1, 2], 'batch')(batch))).resolves.toEqual(
      [1, 2],
    )
    expect(request.workerProfiles()[0]?.identity.jobs).toEqual(batch)
    const custom = createWorkerQueryProfileHelpers({ ...f.options, identities: () => batch })
    await expect(custom.wrapProcessor(() => 3, 'custom')(null)).resolves.toBe(3)
    expect(() => f.wrapProcessor(null, 'invalid')).toThrow(TypeError)
    expect(workerQueryIdentities({ id: 'one', name: 'first' })).toEqual([batch[0]])
  })

  it('preserves the exact business error and serializes nested profiles only when enabled', async () => {
    const f = fixture()
    vi.stubEnv(f.options.diagnosticsEnvVar, '1')
    const child = f.wrapProcessor(() => 2, 'child')
    const parent = f.wrapProcessor(async () => child({ id: 'child', name: 'nested' }), 'parent')
    await expect(parent({ id: 'parent', name: 'root' })).resolves.toBe(2)
    const records = f.lines.map((line) => JSON.parse(line))
    expect(records.at(-1)).toMatchObject({
      kind: 'test-worker',
      profile: { children: [{ identity: { queue: 'child' } }] },
    })
    const error = { business: 'failed' }
    await expect(
      f.wrapProcessor(() => {
        throw error
      }, 'errors')({ id: 'e', name: 'failure' }),
    ).rejects.toBe(error)
  })

  it('isolates observer failures and collector failures while honoring listener removals', async () => {
    const f = fixture()
    const collectorError = new Error('collector')
    const helper = createWorkerQueryProfileHelpers({
      ...f.options,
      recordViolation: () => {
        throw collectorError
      },
    })
    const queue = new Queue(`observers-${crypto.randomUUID()}`)
    const worker = new helper.Worker(queue, () => 10)
    const seen: WorkerQueryProfile[] = []
    let removeLater = () => {}
    const addedDuringDelivery = vi.fn(() => undefined)
    worker.observeQueryProfiles(() => {
      worker.observeQueryProfiles(addedDuringDelivery)
      removeLater()
      throw new Error('listener')
    })
    const skipped = vi.fn()
    removeLater = worker.observeQueryProfiles(skipped)
    worker.observeQueryProfiles((profile) => {
      seen.push(profile)
      return undefined
    })
    try {
      const job = await queue.add('work', {})
      expect((await queue.getJob(job!.id))?.returnvalue).toBe(10)
      expect(skipped).not.toHaveBeenCalled()
      expect(addedDuringDelivery).not.toHaveBeenCalled()
      expect(seen[0]?.reportingFailures().map((failure) => failure.stage)).toEqual([
        'profile-observer',
        'violation-collector',
      ])
      expect(f.lines).toHaveLength(1)
    } finally {
      await worker.close()
      await queue.close()
    }
  })

  it('publishes owner failures without suppressing instance observers or business results', async () => {
    const f = fixture()
    const failure = new Error('owner callback')
    const queue = new Queue(`owner-${crypto.randomUUID()}`)
    const processor = f.wrapProcessor(
      () => 17,
      queue.name,
      () => {
        throw failure
      },
    )
    const worker = new f.Worker(queue, processor)
    const seen: WorkerQueryProfile[] = []
    worker.observeQueryProfiles((profile) => {
      seen.push(profile)
      return undefined
    })
    try {
      const job = await queue.add('owner', {})
      expect((await queue.getJob(job!.id))?.returnvalue).toBe(17)
      expect(seen).toHaveLength(1)
      expect(f.violations).toEqual(['Independent worker query profile reporting failed'])
      expect(seen[0]?.reportingFailures()).toEqual([{ stage: 'profile-owner', reason: failure }])
      expect(f.lines).toHaveLength(1)
    } finally {
      await worker.close()
      await queue.close()
    }
  })

  it('records output failures without replacing success or failure, using injected or stderr output', async () => {
    const f = fixture()
    vi.stubEnv(f.options.diagnosticsEnvVar, '1')
    const outputError = new Error('output')
    const helper = createWorkerQueryProfileHelpers({
      ...f.options,
      output: () => {
        throw outputError
      },
    })
    const request = f.profiles.createRequestQueryProfile()
    await expect(
      request.run(() => helper.wrapProcessor(() => 'ok', 'output')({ id: 'o', name: 'output' })),
    ).resolves.toBe('ok')
    expect(request.workerProfiles()[0]?.reportingFailures()[0]?.reason).toBe(outputError)
    expect(f.violations).toHaveLength(1)
    const businessError = new Error('business')
    await expect(
      helper.wrapProcessor(() => {
        throw businessError
      }, 'failed-output')({ id: 'f', name: 'failed-output' }),
    ).rejects.toBe(businessError)
    expect(f.violations).toHaveLength(2)
    const { output: _output, ...stderrOptions } = f.options
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    await createWorkerQueryProfileHelpers(stderrOptions).wrapProcessor(
      () => 1,
      'stderr',
    )({ id: 's', name: 'stderr' })
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('"kind":"test-worker"'))
  })
})
