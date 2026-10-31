import type { ReviewSide } from '../gha-review-payload/index.mts'

export const PILLARS = [
  'rules',
  'correctness',
  'design',
  'blast-radius',
  'security',
  'history',
  'congruence',
] as const
export type Pillar = (typeof PILLARS)[number]

export const SEVERITIES = ['blocking', 'high', 'medium', 'low'] as const
export type Severity = (typeof SEVERITIES)[number]

export const EFFORTS = ['low', 'medium', 'high'] as const
export type Effort = (typeof EFFORTS)[number]

export type Finding = {
  pillar: Pillar
  severity: Severity
  title: string
  body: string
  path?: string
  line?: number
  side?: ReviewSide
  startLine?: number
}

export type SkippedPillar = { pillar: Pillar; reason: string }

export type FinalReviewInput = {
  effort: Effort
  summary: string
  skipped: SkippedPillar[]
  findings: Finding[]
}

export class FinalReviewError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FinalReviewError'
  }
}

type Json = Record<string, unknown>

function isRecord(value: unknown): value is Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function oneOf<T extends string>(values: readonly T[], value: unknown, field: string): T {
  const found = values.find((candidate) => candidate === value)
  if (found === undefined) {
    throw new FinalReviewError(`${field} must be one of ${values.join(', ')}.`)
  }
  return found
}

function text(record: Json, field: string, where: string): string {
  const value = record[field]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new FinalReviewError(`${where}.${field} must be a non-empty string.`)
  }
  return value
}

function positiveInt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new FinalReviewError(`${field} must be a positive integer.`)
  }
  return value
}

function parseLocation(record: Json, where: string): Partial<Finding> {
  if (record.path === undefined) {
    if (record.line !== undefined) throw new FinalReviewError(`${where}.line needs a path.`)
    return {}
  }
  const path = text(record, 'path', where)
  if (path.includes('\0')) throw new FinalReviewError(`${where}.path is invalid.`)
  if (record.line === undefined) return { path }
  const line = positiveInt(record.line, `${where}.line`)
  const side =
    record.side === undefined ? 'RIGHT' : oneOf(['LEFT', 'RIGHT'], record.side, `${where}.side`)
  if (record.startLine === undefined) return { path, line, side }
  const startLine = positiveInt(record.startLine, `${where}.startLine`)
  // Models often send a one-line range or reversed bounds; normalize instead of rejecting.
  if (startLine === line) return { path, line, side }
  if (startLine > line) return { path, line: startLine, side, startLine: line }
  return { path, line, side, startLine }
}

function parseFinding(raw: unknown, index: number): Finding {
  const where = `findings[${index}]`
  if (!isRecord(raw)) throw new FinalReviewError(`${where} must be an object.`)
  return {
    pillar: oneOf(PILLARS, raw.pillar, `${where}.pillar`),
    severity: oneOf(SEVERITIES, raw.severity, `${where}.severity`),
    title: text(raw, 'title', where).trim(),
    body: text(raw, 'body', where).trim(),
    ...parseLocation(raw, where),
  }
}

function parseSkipped(raw: unknown, index: number): SkippedPillar {
  const where = `skipped[${index}]`
  if (!isRecord(raw)) throw new FinalReviewError(`${where} must be an object.`)
  return {
    pillar: oneOf(PILLARS, raw.pillar, `${where}.pillar`),
    reason: text(raw, 'reason', where),
  }
}

function list(record: Json, field: string): unknown[] {
  const value = record[field] ?? []
  if (!Array.isArray(value)) throw new FinalReviewError(`${field} must be an array.`)
  return value
}

/** Validates the verifier's collected findings; malformed input fails closed. */
export function parseFinalReviewInput(raw: unknown): FinalReviewInput {
  if (!isRecord(raw)) throw new FinalReviewError('Input must be a JSON object.')
  return {
    effort: raw.effort === undefined ? 'high' : oneOf(EFFORTS, raw.effort, 'effort'),
    summary: typeof raw.summary === 'string' ? raw.summary.trim() : '',
    skipped: list(raw, 'skipped').map(parseSkipped),
    findings: list(raw, 'findings').map(parseFinding),
  }
}
