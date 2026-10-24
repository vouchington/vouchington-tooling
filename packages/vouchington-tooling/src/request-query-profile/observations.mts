import { parseRequestProfileLine, REQUEST_PROFILE_PREFIX } from './line.mts'

export interface ProfileObservations {
  requestProfileCount: number
  workerProfileCount: number
  malformedRequestProfileCount: number
  malformedWorkerProfileCount: number
  routeScopes: Set<string>
  workerScopes: Set<string>
}

/** Collect exact repeated-query scopes and valid request/worker diagnostics from run logs. */
export function collectProfileObservations(
  logTexts: readonly string[],
  resolveRoute: (route: string) => string,
): ProfileObservations {
  const observations: ProfileObservations = {
    requestProfileCount: 0,
    workerProfileCount: 0,
    malformedRequestProfileCount: 0,
    malformedWorkerProfileCount: 0,
    routeScopes: new Set(),
    workerScopes: new Set(),
  }
  for (const logText of logTexts) {
    for (const line of logText.split('\n')) {
      if (line.includes('"kind":"pg-worker-profile"')) {
        collectWorkerLine(line, observations)
      } else if (line.includes(REQUEST_PROFILE_PREFIX)) {
        collectRequestLine(line, observations, resolveRoute)
      }
    }
  }
  return observations
}

function collectRequestLine(
  line: string,
  observations: ProfileObservations,
  resolveRoute: (route: string) => string,
): void {
  const parsed = parseRequestProfileLine(line)
  if (parsed === undefined) {
    observations.malformedRequestProfileCount += 1
    return
  }
  observations.requestProfileCount += 1
  const resolvedRoute = resolveRoute(parsed.route)
  for (const { annotation } of parsed.repeats) {
    observations.routeScopes.add(JSON.stringify([annotation, resolvedRoute]))
  }
}

function collectWorkerLine(line: string, observations: ProfileObservations): void {
  const marker = line.indexOf('"kind":"pg-worker-profile"')
  const start = line.lastIndexOf('{', marker)
  if (start === -1) {
    observations.malformedWorkerProfileCount += 1
    return
  }
  let report: unknown
  try {
    report = JSON.parse(line.slice(start))
  } catch {
    observations.malformedWorkerProfileCount += 1
    return
  }
  const root = asRecord(report)
  if (root?.kind !== 'pg-worker-profile' || !collectWorkerProfile(root.profile, observations)) {
    observations.malformedWorkerProfileCount += 1
  }
}

function collectWorkerProfile(profileValue: unknown, observations: ProfileObservations): boolean {
  const profile = asRecord(profileValue)
  if (!profile) return false
  const identity = asRecord(profile.identity)
  const summary = asRecord(profile.summary)
  const queue = identity?.queue
  const jobs = Array.isArray(identity?.jobs) ? identity.jobs : []
  const validJobs =
    jobs.length > 0 &&
    jobs.every((jobValue) => {
      const job = asRecord(jobValue)
      return typeof job?.name === 'string' && job.name.trim() !== ''
    })
  const jobNames = validJobs ? jobs.map((jobValue) => (jobValue as { name: string }).name) : []
  const repeats = summary?.repeats
  const repeatEntries = Array.isArray(repeats) ? repeats : []
  const validRepeats =
    Array.isArray(repeats) &&
    repeatEntries.every((repeatValue) => {
      const repeat = asRecord(repeatValue)
      return (
        typeof repeat?.annotation === 'string' &&
        repeat.annotation.trim() !== '' &&
        Number.isInteger(repeat.count) &&
        (repeat.count as number) >= 2
      )
    })
  const valid = typeof queue === 'string' && queue.trim() !== '' && validJobs && validRepeats
  if (valid) {
    observations.workerProfileCount += 1
    for (const jobName of jobNames) {
      for (const repeatValue of repeatEntries) {
        const { annotation } = repeatValue as { annotation: string }
        observations.workerScopes.add(JSON.stringify([annotation, queue, jobName]))
      }
    }
  }
  let childrenValid = profile.children === undefined
  if (Array.isArray(profile.children)) {
    childrenValid = true
    for (const child of profile.children) {
      if (!collectWorkerProfile(child, observations)) childrenValid = false
    }
  }
  return valid && childrenValid
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}
