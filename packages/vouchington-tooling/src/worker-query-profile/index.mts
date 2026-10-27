import type { QueryProfiles, WorkerQueryProfile } from '@vouchington/postgres/query-telemetry'
import {
  Worker as SdkWorker,
  getTestWorkerProcessorDecorator,
  setTestWorkerProcessorDecorator,
  type WorkerOptions,
} from '@vouchington/worker-runtime/testing'
import { finishProfile, reportFailure, type WorkerProfileReporting } from './reporting.mts'

export type ProfileObserver = (profile: WorkerQueryProfile) => undefined
export type WorkerProcessor<R = unknown> = (job: any) => R | Promise<R>
interface ProcessorMetadata {
  base: WorkerProcessor
  observers: Set<ProfileObserver>
  rewrap: (processor: WorkerProcessor, queue: string) => WorkerProcessor
}
// Function identity, rather than queue identity, separates workers sharing a queue or processor.
// The global registry also recognizes factory decorators retained across module resets.
const metadataKey = Symbol.for('vouchington-tooling.worker-query-profile.metadata.v1')
const metadata = ((
  globalThis as typeof globalThis & {
    [metadataKey]?: WeakMap<object, ProcessorMetadata>
  }
)[metadataKey] ??= new WeakMap<object, ProcessorMetadata>())

export interface WorkerQueryProfileOptions extends WorkerProfileReporting {
  profiles: Pick<QueryProfiles, 'runIndependentWorker'>
  identities?: (input: unknown) => { id: string; name: string }[]
}

export function workerQueryIdentities(input: unknown): { id: string; name: string }[] {
  const jobs: unknown[] = Array.isArray(input) ? input : [input]
  if (!jobs.length) throw new Error('Test worker profiles require every batch member identity')
  return jobs.map((job) => {
    if (
      !job ||
      typeof job !== 'object' ||
      !('id' in job) ||
      !('name' in job) ||
      typeof job.id !== 'string' ||
      !job.id ||
      typeof job.name !== 'string' ||
      !job.name
    ) {
      throw new Error('Test worker profiles require every batch member identity')
    }
    return { id: job.id, name: job.name }
  })
}

export interface ProfiledWorker<D = unknown, R = unknown> extends SdkWorker<D, R> {
  observeQueryProfiles(observer: ProfileObserver): () => void
}

export interface WorkerQueryProfileHelpers {
  Worker: Omit<typeof SdkWorker, 'prototype'> & {
    readonly prototype: ProfiledWorker
    new <D = unknown, R = unknown>(
      queue: ConstructorParameters<typeof SdkWorker<D, R>>[0],
      processor: ConstructorParameters<typeof SdkWorker<D, R>>[1],
      options?: WorkerOptions<R>,
    ): ProfiledWorker<D, R>
  }
  wrapProcessor<R>(
    processor: WorkerProcessor<R>,
    queue: string,
    observe?: ProfileObserver,
  ): (job: any) => Promise<R>
  wrapProcessor(processor: unknown, queue: string, observe?: ProfileObserver): WorkerProcessor
  install: () => () => void
}

/** Test-only profiling instrumentation; business work stays in the SDK worker. */
export function createWorkerQueryProfileHelpers(
  options: WorkerQueryProfileOptions,
): WorkerQueryProfileHelpers {
  function wrapProcessor<R>(
    processor: WorkerProcessor<R>,
    queue: string,
    observe?: ProfileObserver,
  ): (job: any) => Promise<R>
  function wrapProcessor(
    processor: unknown,
    queue: string,
    observe?: ProfileObserver,
  ): WorkerProcessor
  function wrapProcessor(
    processor: unknown,
    queue: string,
    observe?: ProfileObserver,
  ): WorkerProcessor {
    if (typeof processor !== 'function') {
      throw new TypeError('Test worker processor decorators require a function')
    }
    return decorate(processor as WorkerProcessor, queue, new Set<ProfileObserver>(), observe)
  }

  function decorate(
    base: WorkerProcessor,
    queue: string,
    observers: Set<ProfileObserver>,
    observe?: ProfileObserver,
  ): WorkerProcessor {
    const wrapped = async (job: unknown) => {
      const worker = options.profiles.runIndependentWorker(
        { queue, jobs: (options.identities ?? workerQueryIdentities)(job) },
        () => Promise.resolve(base(job)),
        (profile) => {
          // A snapshot defers observers added during delivery until the next profile.
          // oxlint-disable-next-line unicorn/no-useless-spread
          for (const observer of [...observers]) {
            if (!observers.has(observer)) continue
            try {
              observer(profile)
            } catch (error) {
              reportFailure(profile, 'profile-observer', error, options)
            }
          }
          observe?.(profile)
        },
      )
      try {
        return await worker.completion
      } finally {
        finishProfile(worker.profile, options)
      }
    }
    metadata.set(wrapped, {
      base,
      observers,
      rewrap: (processor, queue) => decorate(processor, queue, new Set<ProfileObserver>(), observe),
    })
    return wrapped
  }

  class Worker<D = unknown, R = unknown> extends SdkWorker<D, R> {
    private readonly profileObservers: Set<ProfileObserver>

    constructor(
      queueNameOrQueue: ConstructorParameters<typeof SdkWorker<D, R>>[0],
      processor: ConstructorParameters<typeof SdkWorker<D, R>>[1],
      workerOptions?: WorkerOptions<R>,
    ) {
      const queue = typeof queueNameOrQueue === 'string' ? queueNameOrQueue : queueNameOrQueue.name
      const existing = metadata.get(processor)
      const { wrapProcessor: callerWrap, ...sdkOptions } = workerOptions ?? {}
      const base = existing?.base ?? processor
      const callerWrapped = callerWrap?.(base as WorkerProcessor<R>, queue) ?? base
      const decorated = existing
        ? existing.rewrap(callerWrapped, queue)
        : wrapProcessor(callerWrapped, queue)
      const observers = metadata.get(decorated)!.observers
      super(queueNameOrQueue, decorated as WorkerProcessor<R>, sdkOptions)
      this.profileObservers = observers
    }

    observeQueryProfiles(observer: ProfileObserver): () => void {
      this.profileObservers.add(observer)
      return () => {
        this.profileObservers.delete(observer)
      }
    }
  }

  let installations = 0
  let restoreInstallation: () => void
  function install(): () => void {
    if (installations === 0) {
      const previous = getTestWorkerProcessorDecorator()
      const installed = previous
        ? (processor: unknown, queue: string) => wrapProcessor(previous(processor, queue), queue)
        : wrapProcessor
      setTestWorkerProcessorDecorator(installed)
      restoreInstallation = () => {
        if (getTestWorkerProcessorDecorator() === installed)
          setTestWorkerProcessorDecorator(previous)
      }
    }
    installations++
    let active = true
    return () => {
      if (!active) return
      active = false
      if (--installations === 0) restoreInstallation()
    }
  }
  return { Worker, wrapProcessor, install }
}
