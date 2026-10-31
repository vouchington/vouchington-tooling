import { FinalReviewError, PILLARS, SEVERITIES, type Pillar, type Severity } from '../finding.mts'

export type ExpectedFinding = {
  pillar: Pillar
  severity: Severity
  path: string | null
  lines: [number, number] | null
  claim: string
}

export type EvalCase = {
  id: string
  repo: string
  pr: number
  title: string
  baseSha: string
  headSha: string
  kind: 'positive' | 'negative'
  reason: string
  expected: ExpectedFinding[]
}

type Json = Record<string, unknown>

const SHA_RE = /^[0-9a-f]{40}$/u
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u

function isRecord(value: unknown): value is Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function fail(where: string, message: string): never {
  throw new FinalReviewError(`${where}: ${message}`)
}

function str(record: Json, field: string, where: string): string {
  const value = record[field]
  if (typeof value !== 'string') fail(where, `${field} must be a string`)
  return value
}

function lines(value: unknown, where: string): [number, number] | null {
  if (value === null || value === undefined) return null
  if (!Array.isArray(value) || value.length !== 2) fail(where, 'lines must be [start, end] or null')
  const [start, end] = value as unknown[]
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    (start as number) < 1 ||
    (end as number) < (start as number)
  ) {
    fail(where, 'lines must be ascending positive integers')
  }
  return [start as number, end as number]
}

function expected(raw: unknown, where: string): ExpectedFinding {
  if (!isRecord(raw)) fail(where, 'must be an object')
  const pillar = PILLARS.find((name) => name === raw.pillar) ?? fail(where, 'unknown pillar')
  const severity =
    SEVERITIES.find((name) => name === raw.severity) ?? fail(where, 'unknown severity')
  const path = typeof raw.path === 'string' && raw.path.length > 0 ? raw.path : null
  return { pillar, severity, path, lines: lines(raw.lines, where), claim: str(raw, 'claim', where) }
}

function evalCase(raw: unknown, index: number): EvalCase {
  const where = `cases[${index}]`
  if (!isRecord(raw)) fail(where, 'must be an object')
  const repo = str(raw, 'repo', where)
  if (!REPO_RE.test(repo)) fail(where, 'repo must be owner/name')
  const baseSha = str(raw, 'baseSha', where)
  const headSha = str(raw, 'headSha', where)
  if (!SHA_RE.test(baseSha) || !SHA_RE.test(headSha))
    fail(where, 'baseSha and headSha must be full SHAs')
  if (raw.kind !== 'positive' && raw.kind !== 'negative')
    fail(where, 'kind must be positive or negative')
  if (!Number.isInteger(raw.pr) || (raw.pr as number) <= 0)
    fail(where, 'pr must be a positive integer')
  const items = Array.isArray(raw.expected)
    ? raw.expected
    : fail(where, 'expected must be an array')
  const parsed = items.map((item, at) => expected(item, `${where}.expected[${at}]`))
  if (raw.kind === 'positive' && parsed.length === 0)
    fail(where, 'a positive case needs an expected finding')
  if (raw.kind === 'negative' && parsed.length > 0)
    fail(where, 'a negative case has no expected findings')
  return {
    id: str(raw, 'id', where),
    repo,
    pr: raw.pr as number,
    title: str(raw, 'title', where),
    baseSha,
    headSha,
    kind: raw.kind,
    reason: typeof raw.reason === 'string' ? raw.reason : '',
    expected: parsed,
  }
}

/** Parses labeled eval cases; ids must be unique. */
export function parseEvalCases(raw: unknown): EvalCase[] {
  if (!Array.isArray(raw)) throw new FinalReviewError('Eval cases must be a JSON array.')
  const cases = raw.map(evalCase)
  const seen = new Set<string>()
  for (const item of cases) {
    if (seen.has(item.id)) throw new FinalReviewError(`Duplicate eval case id: ${item.id}`)
    seen.add(item.id)
  }
  return cases
}

/** Cases that exercise one pillar: its positives plus every negative. */
export function casesForPillar(cases: readonly EvalCase[], pillar: Pillar): EvalCase[] {
  return cases.filter(
    (item) => item.kind === 'negative' || item.expected.some((entry) => entry.pillar === pillar),
  )
}
