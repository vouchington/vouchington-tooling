import { afterEach, describe, expect, it, vi } from 'vitest'
import { createQueryProfiles, type WorkerQueryProfile } from '@vouchington/postgres/query-telemetry'
import { setTestWorkerProcessorDecorator } from '@vouchington/worker-runtime/testing'
import { createGlideMqRuntime } from '@vouchington/worker-runtime/glide-mq'
import { createWorkerQueryProfileHelpers } from './index.mts'

// Replace the network worker constructor with the public in-memory SDK adapter.
// The actual SDK factory still owns decorator selection and processor composition.
const boundary = vi.hoisted(() => ({
  construct: undefined as undefined | ((name: string, processor: any, options: any) => object),
}))
vi.mock('glide-mq', async (importOriginal) => ({
  ...(await importOriginal<typeof import('glide-mq')>()),
  Worker: function Worker(name: string, processor: unknown, options: unknown) {
    return boundary.construct!(name, processor, options)
  },
}))

afterEach(() => {
  setTestWorkerProcessorDecorator(undefined)
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('runtime factory integration', () => {
  it.each([false, true])(
    'profiles actual factory admission exactly once after reset: %s',
    async (reset) => {
      const profiles = createQueryProfiles({ registryKey: Symbol() })
      const violations: string[] = []
      const records: string[] = []
      vi.stubEnv('FACTORY_TEST_DIAGNOSTICS', '1')
      const helpers = createWorkerQueryProfileHelpers({
        profiles,
        recordKind: 'factory-test',
        output: (line) => {
          records.push(line)
        },
        diagnosticsEnvVar: 'FACTORY_TEST_DIAGNOSTICS',
        recordViolation: (message) => {
          violations.push(message)
        },
      })
      const restore = helpers.install()
      if (reset) vi.resetModules()
      const { createWorkerQueryProfileHelpers: createReloaded } = await import('./index.mts')
      const adapter = createReloaded({
        profiles,
        recordKind: 'unused',
        diagnosticsEnvVar: 'UNUSED_DIAGNOSTICS',
        recordViolation: () => {},
      })
      boundary.construct = (name, processor, options) =>
        new adapter.Worker(name, processor, options)
      const calls: string[] = []
      const runtime = createGlideMqRuntime({
        connection: { addresses: [{ host: '127.0.0.1', port: 1 }] },
        onError: (error) => {
          throw error
        },
        wrapProcessor: (base) => (job) => {
          calls.push('configured')
          profiles.observe({ durationMs: 1, annotation: 'configuration' })
          return base(job)
        },
      })
      const { Queue } = await import('@vouchington/worker-runtime/testing')
      const name = `factory-${crypto.randomUUID()}`
      const queue = new Queue<{ value: number }, number>(name)
      const worker = runtime.createWorker<{ value: number }, number>(name, async (job) => {
        calls.push('business')
        profiles.observe({ durationMs: 2, annotation: 'business' })
        return job.data.value
      })
      const observed: WorkerQueryProfile[] = []
      expect(worker).toBeInstanceOf(adapter.Worker)
      const stop = adapter.Worker.prototype.observeQueryProfiles.call(
        worker as unknown as InstanceType<typeof adapter.Worker>,
        (profile) => {
          observed.push(profile)
          return undefined
        },
      )
      try {
        const request = profiles.createRequestQueryProfile()
        const job = await request.run(() => queue.add('admitted', { value: 12 }))
        expect((await queue.getJob(job!.id))?.returnvalue).toBe(12)
        expect(calls).toEqual(['configured', 'business'])
        expect(observed).toHaveLength(1)
        expect(observed[0]?.queries().map((query) => query.annotation)).toEqual([
          'configuration',
          'business',
        ])
        expect(observed[0]?.workerProfiles()).toEqual([])
        expect(violations).toEqual([])
        expect(records).toHaveLength(1)
        expect(JSON.parse(records[0]!)).toMatchObject({ kind: 'factory-test' })
      } finally {
        stop()
        restore()
        await worker.close()
        await queue.close()
      }
    },
  )
})
