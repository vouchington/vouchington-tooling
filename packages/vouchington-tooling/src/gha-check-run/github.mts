import type { GhExec } from '../gha-post-review/github.mts'

export class CheckRunError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CheckRunError'
  }
}

export type CheckRunStatus = 'in_progress' | 'completed'
export type CheckRunConclusion = 'success' | 'neutral'

export type CreateCheckRunInput = {
  repository: string
  name: string
  headSha: string
  title: string
  summary: string
} & (
  | { status: 'in_progress'; conclusion?: undefined }
  | { status: 'completed'; conclusion: CheckRunConclusion }
)

export type CompleteCheckRunInput = {
  repository: string
  checkRunId: string
  conclusion: CheckRunConclusion
  title: string
  summary: string
}

function isFullCommitSha(value: string): boolean {
  return /^[0-9a-f]{40}$/u.test(value)
}

function isCheckRunId(value: string): boolean {
  return /^[0-9]+$/u.test(value)
}

function parseCheckRunId(raw: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new CheckRunError('Check run creation response was not valid JSON.')
  }
  const id =
    parsed !== null && typeof parsed === 'object' ? (parsed as { id?: unknown }).id : undefined
  if (typeof id !== 'number' && typeof id !== 'string') {
    throw new CheckRunError('Check run creation response did not include an id.')
  }
  return String(id)
}

/** Creates a GitHub check run, returning the API-assigned check run id. */
export function createCheckRun(input: CreateCheckRunInput, exec: GhExec): string {
  if (!isFullCommitSha(input.headSha)) {
    throw new CheckRunError('headSha must be a full lowercase 40-character commit SHA.')
  }
  const body: Record<string, unknown> = {
    name: input.name,
    head_sha: input.headSha,
    status: input.status,
    output: { title: input.title, summary: input.summary },
  }
  if (input.status === 'completed') body.conclusion = input.conclusion
  const raw = exec(
    ['api', '--method', 'POST', `repos/${input.repository}/check-runs`, '--input', '-'],
    {
      input: JSON.stringify(body),
    },
  )
  return parseCheckRunId(raw)
}

/** Transitions an existing check run to `completed` with a final conclusion. */
export function completeCheckRun(input: CompleteCheckRunInput, exec: GhExec): void {
  if (!isCheckRunId(input.checkRunId)) {
    throw new CheckRunError('checkRunId must be a positive integer.')
  }
  const body = {
    status: 'completed',
    conclusion: input.conclusion,
    output: { title: input.title, summary: input.summary },
  }
  exec(
    [
      'api',
      '--method',
      'PATCH',
      `repos/${input.repository}/check-runs/${input.checkRunId}`,
      '--input',
      '-',
    ],
    { input: JSON.stringify(body) },
  )
}
