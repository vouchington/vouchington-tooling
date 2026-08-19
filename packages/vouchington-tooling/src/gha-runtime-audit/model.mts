export interface GhApiRequest {
  endpoint: string
  jq: string
}

export type GhApiExecutor = (request: GhApiRequest) => Promise<unknown>

export interface WorkflowRecord {
  id: number
  name: string
  state: string
}

export interface RunRecord {
  id: number
  name: string
  event: string
  conclusion: string
  createdAt: string
  url: string
  headBranch: string | null
  pullRequestBaseBranches: string[]
}

export interface RuntimeSample {
  runId: number
  runUrl: string
  jobId: number
  jobUrl: string
  startedAt: string
  completedAt: string
  durationSeconds: number
}

export type RuntimeViolationReason =
  | 'sample-at-or-above-hard-ceiling'
  | 'five-sample-median-above-threshold'

export interface RuntimeJobResult {
  key: string
  workflow: string
  job: string
  sampleCount: number
  medianSeconds: number | null
  maximumSeconds: number
  reasons: RuntimeViolationReason[]
  samples: RuntimeSample[]
}

export interface RuntimeAuditResult {
  scope: {
    repository: string
    sampleLimit: number
    recentCompletedRunHorizon: number
    medianThresholdSeconds: number
    hardCeilingSeconds: number
    branch: string
  }
  jobs: RuntimeJobResult[]
  violations: RuntimeJobResult[]
}

function malformed(detail: string): never {
  throw new Error(`Malformed GitHub API data: ${detail}`)
}

export function parseObject(value: unknown, detail: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) malformed(detail)
  return value as Record<string, unknown>
}

function parseString(value: unknown, detail: string): string {
  if (typeof value !== 'string' || value.length === 0) malformed(detail)
  return value
}

function parseNumber(value: unknown, detail: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) malformed(detail)
  return value
}

export function parseArray(value: unknown, detail: string): unknown[] {
  if (!Array.isArray(value)) malformed(detail)
  return value
}

function parseTimestamp(value: unknown, detail: string): string {
  const timestamp = parseString(value, `${detail} must be a non-empty string`)
  if (!Number.isFinite(Date.parse(timestamp))) malformed(`${detail} must be an ISO timestamp`)
  return timestamp
}

export function parseRun(value: unknown): RunRecord {
  const run = parseObject(value, 'workflow run must be an object')
  const pullRequests = parseArray(
    run['pull_requests'],
    'workflow run pull_requests must be an array',
  )
  const pullRequestBaseBranches: string[] = []
  for (const [index, entry] of pullRequests.entries()) {
    const pullRequest = parseObject(entry, `pull_requests[${index}] must be an object`)
    const base = parseObject(pullRequest['base'], `pull_requests[${index}].base must be an object`)
    pullRequestBaseBranches.push(
      parseString(base['ref'], `pull_requests[${index}].base.ref must be a string`),
    )
  }
  return {
    id: parseNumber(run['id'], 'workflow run id must be a positive integer'),
    name: parseString(run['name'], 'workflow run name must be a non-empty string'),
    event: parseString(run['event'], 'workflow run event must be a non-empty string'),
    conclusion: parseString(
      run['conclusion'],
      'workflow run conclusion must be a non-empty string',
    ),
    createdAt: parseTimestamp(run['created_at'], 'workflow run created_at'),
    url: parseString(run['html_url'], 'workflow run html_url must be a non-empty string'),
    headBranch:
      run['head_branch'] === null
        ? null
        : parseString(run['head_branch'], 'workflow run head_branch'),
    pullRequestBaseBranches,
  }
}

export function parseWorkflow(value: unknown): WorkflowRecord {
  const workflow = parseObject(value, 'workflow must be an object')
  return {
    id: parseNumber(workflow['id'], 'workflow id must be a positive integer'),
    name: parseString(workflow['name'], 'workflow name must be a non-empty string'),
    state: parseString(workflow['state'], 'workflow state must be a non-empty string'),
  }
}

export function parseSample(
  value: unknown,
  run: RunRecord,
): { name: string; sample: RuntimeSample } | null {
  const job = parseObject(value, `job in run ${run.id} must be an object`)
  const conclusion = parseString(
    job['conclusion'],
    `job in run ${run.id} conclusion must be a string`,
  )
  if (conclusion !== 'success') return null
  const startedAt = parseTimestamp(job['started_at'], `job in run ${run.id} started_at`)
  const completedAt = parseTimestamp(job['completed_at'], `job in run ${run.id} completed_at`)
  const durationSeconds = (Date.parse(completedAt) - Date.parse(startedAt)) / 1000
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
    malformed(`job in run ${run.id} has an invalid execution interval`)
  }
  return {
    name: parseString(job['name'], `job in run ${run.id} name must be a non-empty string`),
    sample: {
      runId: run.id,
      runUrl: run.url,
      jobId: parseNumber(job['id'], `job in run ${run.id} id must be a positive integer`),
      jobUrl: parseString(job['html_url'], `job in run ${run.id} html_url must be a string`),
      startedAt,
      completedAt,
      durationSeconds,
    },
  }
}
