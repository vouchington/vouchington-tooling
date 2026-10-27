import type { WorkerQueryProfile } from '@vouchington/postgres/query-telemetry'

export interface WorkerProfileReporting {
  recordViolation: (message: string) => void
  recordKind: string
  diagnosticsEnvVar: string
  output?: (line: string) => void
}

function publishViolation(profile: WorkerQueryProfile, options: WorkerProfileReporting): void {
  try {
    options.recordViolation('Independent worker query profile reporting failed')
  } catch (error) {
    profile.reportFailure('violation-collector', error)
  }
}

export function reportFailure(
  profile: WorkerQueryProfile,
  stage: string,
  error: unknown,
  options: WorkerProfileReporting,
): void {
  profile.reportFailure(stage, error)
  publishViolation(profile, options)
}

function snapshot(profile: WorkerQueryProfile): unknown {
  return {
    identity: profile.identity,
    queries: profile.queries(),
    summary: profile.summarize(),
    reportingFailureStages: profile.reportingFailures().map((failure) => failure.stage),
    children: profile.workerProfiles().map(snapshot),
  }
}

export function finishProfile(profile: WorkerQueryProfile, options: WorkerProfileReporting): void {
  if (profile.reportingFailures().some((failure) => failure.stage.startsWith('profile-owner'))) {
    publishViolation(profile, options)
  }
  try {
    if (process.env[options.diagnosticsEnvVar] !== '1' && !profile.reportingFailures().length)
      return
    const line = `${JSON.stringify({ kind: options.recordKind, pid: process.pid, profile: snapshot(profile) })}\n`
    if (options.output) options.output(line)
    else process.stderr.write(line)
  } catch (error) {
    reportFailure(profile, 'profile-output', error, options)
  }
}
