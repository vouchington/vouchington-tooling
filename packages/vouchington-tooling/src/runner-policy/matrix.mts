import { isRecord, type WorkflowJob } from './workflow.mts'

export type RunsOnResolution =
  | { kind: 'literal'; label: string }
  | { kind: 'matrix'; candidates: string[] }
  | { kind: 'invalid'; reason: string }

const matrixExpression = /^\$\{\{\s*matrix\.([A-Za-z_][A-Za-z0-9_-]*)\s*\}\}$/

const invalid = (reason: string): RunsOnResolution => ({ kind: 'invalid', reason })

const candidateText = (value: unknown): string =>
  typeof value === 'string' ? value : JSON.stringify(value)

function matrixCandidates(job: WorkflowJob, field: string): RunsOnResolution {
  const matrix = isRecord(job.strategy) ? job.strategy.matrix : undefined
  if (!isRecord(matrix)) {
    return invalid(`matrix.${field} cannot be resolved: strategy.matrix is not a mapping`)
  }
  const candidates: unknown[] = []
  const declared = matrix[field]
  if (declared !== undefined) {
    if (!Array.isArray(declared)) return invalid(`matrix.${field} is not an array of labels`)
    candidates.push(...declared)
  }
  if (matrix.include !== undefined) {
    if (!Array.isArray(matrix.include)) return invalid('matrix.include is not an array')
    for (const entry of matrix.include) {
      if (isRecord(entry) && entry[field] !== undefined) candidates.push(entry[field])
    }
  }
  if (candidates.length === 0) return invalid(`matrix.${field} resolves to no candidates`)
  return { kind: 'matrix', candidates: candidates.map(candidateText) }
}

/** Resolves a non-delegate job's `runs-on` to literal label(s), or explains why it cannot. */
export function resolveRunsOn(job: WorkflowJob): RunsOnResolution {
  const runsOn = job['runs-on']
  if (runsOn === undefined || runsOn === null) return invalid('runs-on is missing')
  if (Array.isArray(runsOn)) return invalid('runs-on must not be an array of labels')
  if (typeof runsOn !== 'string') {
    return invalid(`runs-on must be a literal string, got ${typeof runsOn} form`)
  }
  const field = matrixExpression.exec(runsOn)?.[1]
  if (field !== undefined) return matrixCandidates(job, field)
  if (runsOn.includes('${{')) return invalid(`runs-on is a computed expression: ${runsOn}`)
  return { kind: 'literal', label: runsOn }
}
