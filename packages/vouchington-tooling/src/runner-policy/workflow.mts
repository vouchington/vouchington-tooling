import { parse } from 'yaml'

import type { WorkflowInput } from './types.mts'

export interface WorkflowJob {
  uses?: unknown
  'runs-on'?: unknown
  services?: unknown
  strategy?: unknown
  steps?: unknown
}

export interface ParsedWorkflow {
  path: string
  jobs: Map<string, WorkflowJob>
}

export type ParseResult = { ok: true; workflow: ParsedWorkflow } | { ok: false; message: string }

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function parseWorkflowInput(input: WorkflowInput): ParseResult {
  let document: unknown
  try {
    document = parse(input.text)
  } catch (error) {
    return { ok: false, message: `cannot parse YAML: ${(error as Error).message.split('\n')[0]}` }
  }
  if (!isRecord(document) || !isRecord(document.jobs)) {
    return { ok: false, message: 'workflow has no jobs mapping' }
  }
  const jobs = new Map<string, WorkflowJob>()
  for (const [id, job] of Object.entries(document.jobs)) {
    if (!isRecord(job)) return { ok: false, message: `job "${id}" is not a mapping` }
    jobs.set(id, job)
  }
  return { ok: true, workflow: { path: input.path, jobs } }
}

/** `uses` values of a job's steps; non-string values are ignored. */
export function stepUses(job: WorkflowJob): string[] {
  if (!Array.isArray(job.steps)) return []
  return job.steps.flatMap((step: unknown) =>
    isRecord(step) && typeof step.uses === 'string' ? [step.uses] : [],
  )
}

export function hasNonEmptyServices(job: WorkflowJob): boolean {
  const { services } = job
  if (services === undefined || services === null || services === '') return false
  if (Array.isArray(services)) return services.length > 0
  if (isRecord(services)) return Object.keys(services).length > 0
  return true
}
