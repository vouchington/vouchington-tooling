import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { parse as load } from 'yaml'

import type { SharedContext } from '../shared-context/index.mts'
import type { GhaWorkspacePolicyOptions } from './index.mts'

export type GhaFileKind = 'workflow' | 'action'

export function ghaFileKind(
  file: string,
  options: GhaWorkspacePolicyOptions,
): GhaFileKind | undefined {
  const workflowDirectories = options.workflowDirectories ?? ['.github/workflows']
  const actionDirectories = options.actionDirectories ?? ['.github/actions']
  if (
    workflowDirectories.some((directory) => file.startsWith(`${directory.replace(/\/$/u, '')}/`)) &&
    /\.ya?ml$/u.test(file)
  )
    return 'workflow'
  if (
    actionDirectories.some((directory) => file.startsWith(`${directory.replace(/\/$/u, '')}/`)) &&
    /\/action\.ya?ml$/u.test(file)
  )
    return 'action'
  return undefined
}

export function loadWorkflowDocument(ctx: SharedContext, file: string, errors: string[]): unknown {
  try {
    const content = ctx.readTrackedFile?.(file) ?? readFileSync(join(ctx.repoRoot, file), 'utf8')
    return load(content)
  } catch (error) {
    errors.push(`::error file=${file}::${file}: invalid YAML (${(error as Error).message})`)
    return undefined
  }
}

export function visitRunSteps(
  document: unknown,
  isAction: boolean,
  visitor: (scope: string, index: number, step: Record<string, unknown>) => void,
): void {
  if (!document || typeof document !== 'object') return
  if (isAction) {
    const runs = (document as Record<string, unknown>).runs
    if (!runs || typeof runs !== 'object') return
    visitSteps('action', (runs as Record<string, unknown>).steps, visitor)
    return
  }
  const jobs = (document as Record<string, unknown>).jobs
  if (!jobs || typeof jobs !== 'object') return
  for (const [jobId, value] of Object.entries(jobs as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue
    const job = value as Record<string, unknown>
    if (typeof job.uses === 'string') continue
    visitSteps(`job "${jobId}"`, job.steps, visitor)
  }
}

function visitSteps(
  scope: string,
  value: unknown,
  visitor: (scope: string, index: number, step: Record<string, unknown>) => void,
): void {
  if (!Array.isArray(value)) return
  value.forEach((step, index) => {
    if (step && typeof step === 'object') visitor(scope, index, step as Record<string, unknown>)
  })
}
