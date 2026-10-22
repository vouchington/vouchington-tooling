import type { JobEntry, RunFetchEnv } from './run-context-types.mts'

export function annotationMessagesFromPages(stdout: string): string[] {
  const pages = JSON.parse(stdout.trim()) as unknown
  return Array.isArray(pages)
    ? pages.flatMap((page) => (Array.isArray(page) ? page.flatMap(annotationMessage) : []))
    : []
}

function annotationMessage(annotation: unknown): string[] {
  const message = (annotation as { message?: unknown } | null)?.message
  return typeof message === 'string' ? [message] : []
}

/** Lazily fetches and caches check-run annotation messages for the failed jobs. */
export function createAnnotationFetchers(env: RunFetchEnv, failedJobs: readonly JobEntry[]) {
  const cache = new Map<string, string[]>()
  const failures = new Set<string>()

  const failedJobAnnotations = async (jobName: string): Promise<string[]> => {
    const cached = cache.get(jobName)
    if (cached !== undefined) return cached
    const job = failedJobs.find((entry) => entry.name === jobName)
    let messages: string[] = []
    if (job !== undefined) {
      try {
        messages = annotationMessagesFromPages(
          await env.api.call([
            '-X',
            'GET',
            `repos/${env.repository}/check-runs/${job.id}/annotations`,
            '-F',
            'per_page=100',
            '--paginate',
            '--slurp',
          ]),
        )
      } catch {
        failures.add(jobName)
      }
    }
    cache.set(jobName, messages)
    return messages
  }

  return {
    failedJobAnnotations,
    failedJobAnnotationFetchFailures: async () => new Set(failures),
  }
}
