import type {
  ExactLabelJobs,
  ForbiddenActions,
  RequiredJob,
  RestrictedLabel,
  RunnerPolicyConfig,
} from './types.mts'

type Raw = Record<string, unknown>
type Problems = string[]

const isRecord = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function checkKeys(value: Raw, allowed: readonly string[], where: string, problems: Problems) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) problems.push(`${where}: unknown key "${key}"`)
  }
}

function stringList(value: unknown, where: string, problems: Problems, minimum = 0): string[] {
  const ok =
    Array.isArray(value) &&
    value.length >= minimum &&
    value.every((item) => typeof item === 'string' && item.trim() !== '')
  if (!ok) {
    problems.push(
      `${where}: must be ${minimum > 0 ? 'a non-empty' : 'an'} array of non-empty strings`,
    )
  }
  return ok ? (value as string[]) : []
}

function nonEmptyString(value: Raw, key: string, where: string, problems: Problems): string {
  const field = value[key]
  if (typeof field === 'string' && field.trim() !== '') return field
  problems.push(`${where}.${key}: must be a non-empty string`)
  return ''
}

const jobReference = /^[^#\s]+#[^#\s]+$/

function parseRequired(raw: Raw, where: string, problems: Problems): RequiredJob {
  checkKeys(raw, ['workflow', 'job', 'runsOn'], where, problems)
  return {
    workflow: nonEmptyString(raw, 'workflow', where, problems),
    job: nonEmptyString(raw, 'job', where, problems),
    runsOn: nonEmptyString(raw, 'runsOn', where, problems),
  }
}

function parseExact(raw: Raw, where: string, problems: Problems): ExactLabelJobs {
  checkKeys(raw, ['label', 'jobs'], where, problems)
  const jobs = stringList(raw.jobs, `${where}.jobs`, problems)
  for (const job of jobs) {
    if (!jobReference.test(job))
      problems.push(`${where}.jobs: "${job}" must look like workflow#job`)
  }
  if (new Set(jobs).size !== jobs.length) problems.push(`${where}.jobs: entries must be unique`)
  return { label: nonEmptyString(raw, 'label', where, problems), jobs }
}

function parseActions(raw: unknown, where: string, problems: Problems): ForbiddenActions {
  if (raw !== undefined && !isRecord(raw)) {
    problems.push(`${where}: must be an object`)
    return { prefixes: [], contains: [], exact: [] }
  }
  const record = raw ?? {}
  checkKeys(record, ['prefixes', 'contains', 'exact'], where, problems)
  const list = (key: string): string[] =>
    record[key] === undefined ? [] : stringList(record[key], `${where}.${key}`, problems)
  return { prefixes: list('prefixes'), contains: list('contains'), exact: list('exact') }
}

function parseRestricted(raw: Raw, where: string, problems: Problems): RestrictedLabel {
  checkKeys(raw, ['label', 'forbidServices', 'forbiddenActions'], where, problems)
  if (raw.forbidServices !== undefined && typeof raw.forbidServices !== 'boolean') {
    problems.push(`${where}.forbidServices: must be a boolean`)
  }
  return {
    label: nonEmptyString(raw, 'label', where, problems),
    forbidServices: raw.forbidServices !== false,
    forbiddenActions: parseActions(raw.forbiddenActions, `${where}.forbiddenActions`, problems),
  }
}

function entries<T>(
  raw: Raw,
  key: string,
  problems: Problems,
  parse: (item: Raw, where: string, problems: Problems) => T,
): T[] {
  const value = raw[key]
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    problems.push(`${key}: must be an array`)
    return []
  }
  return value.flatMap((item: unknown, index) => {
    const where = `${key}[${String(index)}]`
    if (isRecord(item)) return [parse(item, where, problems)]
    problems.push(`${where}: must be an object`)
    return []
  })
}

/** Validates an untrusted parsed-JSON config; throws one error listing every problem. */
export function parseRunnerPolicyConfig(raw: unknown): RunnerPolicyConfig {
  if (!isRecord(raw)) throw new Error('runner-policy config must be a JSON object')
  const problems: Problems = []
  checkKeys(
    raw,
    ['allowedLabels', 'requiredJobs', 'exactLabelJobs', 'restrictedLabels'],
    'config',
    problems,
  )
  const config: RunnerPolicyConfig = {
    allowedLabels: stringList(raw.allowedLabels, 'allowedLabels', problems, 1),
    requiredJobs: entries(raw, 'requiredJobs', problems, parseRequired),
    exactLabelJobs: entries(raw, 'exactLabelJobs', problems, parseExact),
    restrictedLabels: entries(raw, 'restrictedLabels', problems, parseRestricted),
  }
  if (problems.length > 0) {
    throw new Error(`invalid runner-policy config:\n${problems.map((p) => `  - ${p}`).join('\n')}`)
  }
  return config
}
