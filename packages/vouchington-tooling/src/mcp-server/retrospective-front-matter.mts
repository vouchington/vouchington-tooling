import type { FeedbackReference } from '../agent-blackboard/index.mts'

/** The fields of the front matter `composeRetrospective` writes, with camelCase names. */
export type RetrospectiveFrontMatter = {
  date: string
  issues: FeedbackReference[]
  prs: FeedbackReference[]
  sessionId?: string
  description?: string
  workOutcome?: string
  feedbackCoverage?: { status: string; sources: string[]; droppedCount: number }
  repositories?: string[]
}

const KEYS = [
  'date',
  'issues',
  'prs',
  'session_id',
  'description',
  'work_outcome',
  'feedback_coverage',
  'repositories',
] as const

const isString = (value: unknown): value is string => typeof value === 'string'
const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(isString)
const isReference = (value: unknown): boolean =>
  (isString(value) && value.trim() !== '') || (Number.isSafeInteger(value) && (value as number) > 0)

function fail(message: string): never {
  throw new Error(`retrospective front matter: ${message}`)
}

function parseLines(block: string): Map<string, unknown> {
  const values = new Map<string, unknown>()
  // composeRetrospective joins its sections with blank lines, so blank lines are allowed.
  for (const line of block.split('\n').filter((candidate) => candidate !== '')) {
    const separator = line.indexOf(': ')
    const key = separator < 0 ? '' : line.slice(0, separator)
    if (!(KEYS as readonly string[]).includes(key))
      fail(
        separator < 0 || !/^[a-z_]+$/.test(key)
          ? `malformed line ${JSON.stringify(line)}; each line is "key: <JSON value>"`
          : `unknown key ${key}`,
      )
    if (values.has(key)) fail(`duplicate key ${key}`)
    try {
      values.set(key, JSON.parse(line.slice(separator + 2)))
    } catch {
      fail(`${key} is not a JSON value`)
    }
  }
  return values
}

function coverageOf(value: unknown): RetrospectiveFrontMatter['feedbackCoverage'] {
  const coverage = value as { status?: unknown; sources?: unknown; droppedCount?: unknown } | null
  if (
    typeof coverage !== 'object' ||
    coverage === null ||
    Object.keys(coverage).some((key) => !['status', 'sources', 'droppedCount'].includes(key)) ||
    !isString(coverage.status) ||
    !isStrings(coverage.sources) ||
    !Number.isSafeInteger(coverage.droppedCount)
  )
    fail('feedback_coverage must be { status, sources, droppedCount }')
  return coverage as RetrospectiveFrontMatter['feedbackCoverage']
}

/**
 * Parses the block from the leading `---` line to the next `---` line. Every line is
 * `key: <JSON value>`; unknown keys, duplicates, malformed lines and ill-typed values are errors,
 * and `date`, `issues`, and `prs` are required.
 */
export function parseRetrospectiveFrontMatter(markdown: string): RetrospectiveFrontMatter {
  const block = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(markdown)?.[1]
  if (block === undefined)
    fail(
      'the document must start with a block between two "---" lines, as composeRetrospective writes',
    )
  const values = parseLines(block)
  const { date, issues, prs } = Object.fromEntries(values)
  if (!isString(date) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('date must be a YYYY-MM-DD string')
  for (const [name, list] of [
    ['issues', issues],
    ['prs', prs],
  ] as const)
    if (!Array.isArray(list) || !list.every(isReference))
      fail(`${name} must be an array of positive integers or non-empty strings`)
  const text = (key: string): string | undefined => {
    const value = values.get(key)
    if (value !== undefined && !isString(value)) fail(`${key} must be a string`)
    return value as string | undefined
  }
  const repositories = values.get('repositories')
  if (repositories !== undefined && !isStrings(repositories))
    fail('repositories must be an array of strings')
  const coverage = values.get('feedback_coverage')
  const parsed = {
    date,
    issues: issues as FeedbackReference[],
    prs: prs as FeedbackReference[],
    sessionId: text('session_id'),
    description: text('description'),
    workOutcome: text('work_outcome'),
    feedbackCoverage: coverage === undefined ? undefined : coverageOf(coverage),
    repositories: repositories as string[] | undefined,
  }
  return Object.fromEntries(
    Object.entries(parsed).filter(([, value]) => value !== undefined),
  ) as RetrospectiveFrontMatter
}
