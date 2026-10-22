import { collectDiagnosticWindow, fitDiagnosticWindow } from './log-window.mts'
import type { JobEntry, RunFetchEnv } from './run-context-types.mts'

const STREAM_ATTEMPTS = 3

/**
 * Lazily fetches job logs through a head+tail window, one job at a time, and keeps no more than
 * `limits.totalBytes` of text across the run. A job that cannot be read, or that arrives after the
 * budget is spent, is recorded as a fetch failure with an empty log so rules never see a partial
 * log presented as complete.
 */
export function createLogFetchers(
  env: RunFetchEnv,
  allJobs: readonly JobEntry[],
  failedJobs: readonly JobEntry[],
) {
  const cached = new Map<string, string>()
  const inFlight = new Map<string, Promise<string>>()
  const jobsByName = new Map(allJobs.map((job) => [job.name, job]))
  const failures = new Set<string>()
  let retainedBytes = 0
  let queueTail: Promise<void> = Promise.resolve()

  const readWindow = async (path: string, maxBytes: number): Promise<string> => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        // A fresh collector per attempt drops partial text from a failed stream.
        const log = await collectDiagnosticWindow(env.streamLog(path), env.limits)
        return fitDiagnosticWindow(log, maxBytes)
      } catch (error) {
        if (attempt >= STREAM_ATTEMPTS || !env.api.isRetryable(error)) throw error
        await env.api.sleep(attempt * 1000)
      }
    }
  }

  const fetchWithinBudget = async (job: JobEntry): Promise<string> => {
    let log = ''
    const remaining = env.limits.totalBytes - retainedBytes
    try {
      if (remaining <= 0) throw new Error('log budget exhausted')
      log = await readWindow(`repos/${env.repository}/actions/jobs/${job.id}/logs`, remaining)
      retainedBytes += Buffer.byteLength(log)
    } catch {
      failures.add(job.name)
    }
    cached.set(job.name, log)
    return log
  }

  const fetchLog = (job: JobEntry): Promise<string> => {
    const hit = cached.get(job.name)
    if (hit !== undefined) return Promise.resolve(hit)
    const pending = inFlight.get(job.name)
    if (pending) return pending
    // Sequential on purpose: many failed jobs must not hold many windows at once.
    const settled = queueTail
      .then(() => fetchWithinBudget(job))
      .finally(() => inFlight.delete(job.name))
    inFlight.set(job.name, settled)
    // `fetchWithinBudget` records failures instead of throwing, so the queue never rejects.
    queueTail = settled.then(() => undefined)
    return settled
  }

  let failedLogs: Promise<Map<string, string>> | undefined
  return {
    failedJobLogs: () =>
      (failedLogs ??= (async () => {
        const logs = new Map<string, string>()
        for (const job of failedJobs) logs.set(job.name, await fetchLog(job))
        return logs
      })()),
    jobLogs: async (jobNames: readonly string[]) => {
      const logs = new Map<string, string>()
      for (const name of jobNames) {
        const job = jobsByName.get(name)
        logs.set(name, job === undefined ? '' : await fetchLog(job))
      }
      return logs
    },
    failedJobLogFetchFailures: async () => new Set(failures),
  }
}
