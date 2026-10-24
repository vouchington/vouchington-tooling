const CODE_POINTER = /^[\w./-]+\.\w+:(?:[1-9]\d*(?:-[1-9]\d*)?|[A-Za-z_$][\w$.]*)$/
const ROUTE = /^[A-Z]+ \/[^?\s]*(?: tools\/call [^?\s]+)?$/

function rangeIsOrdered(code: string): boolean {
  const range = /:(\d+)-(\d+)$/.exec(code)
  return range === null || Number(range[1]) <= Number(range[2])
}

/** Validates the exact temporary or permanent metadata shape of one query-profile exception. */
export function baselineEntryProblem(entry: unknown): string | undefined {
  if (typeof entry !== 'object' || entry === null) return 'is not an object'
  const { annotation, reason, routes, workers, maxCount, ...rest } = entry as Record<
    string,
    unknown
  >
  if (typeof annotation !== 'string' || annotation.trim() === '')
    return 'needs a non-empty annotation'
  if (typeof reason !== 'string' || reason.trim() === '') return 'needs a non-empty reason'
  if (
    !Array.isArray(routes) ||
    routes.some((route) => typeof route !== 'string' || !ROUTE.test(route))
  )
    return 'needs `routes` as an array of exact method and path identities without queries'
  if (
    workers !== undefined &&
    (!Array.isArray(workers) ||
      workers.some((worker) => {
        if (typeof worker !== 'object' || worker === null) return true
        const { queue, job, ...extra } = worker as Record<string, unknown>
        return (
          Object.keys(extra).length > 0 ||
          typeof queue !== 'string' ||
          queue.trim() === '' ||
          queue.includes('*') ||
          typeof job !== 'string' ||
          job.trim() === '' ||
          job.includes('*')
        )
      }))
  )
    return 'needs `workers` as exact { queue, job } identities'
  if (routes.length === 0 && (!workers || workers.length === 0))
    return 'needs at least one route or worker identity'
  if (maxCount !== null && (!Number.isInteger(maxCount) || (maxCount as number) < 2))
    return 'needs `maxCount` as an integer at least 2, or null'
  const keys = Object.keys(rest).toSorted().join(',')
  if (keys === 'issue') {
    const { issue } = rest
    if (typeof issue !== 'number' || !Number.isInteger(issue) || issue <= 0)
      return 'needs `issue` to be a positive issue number'
    return undefined
  }
  if (keys === 'code,permanent') {
    if (rest.permanent !== true) return 'needs `permanent: true`'
    if (
      typeof rest.code !== 'string' ||
      !CODE_POINTER.test(rest.code) ||
      rest.code.startsWith('/') ||
      !rangeIsOrdered(rest.code) ||
      rest.code.split(':')[0]!.split('/').includes('..')
    )
      return 'needs `code` as "<repo path>:<line or symbol>"'
    return undefined
  }
  return 'must be temporary { annotation, reason, issue } or permanent { annotation, reason, permanent: true, code }'
}
