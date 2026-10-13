import {
  optionalString,
  rejectUnknown,
  requireObject,
  requiredChoice,
  requiredString,
  requiredStringArray,
  type Args,
} from './args.mts'

const PR_MODES = ['interactive', 'autonomous'] as const
const RELATIONS = ['closes', 'refs'] as const
const MAX_TITLE_CHARACTERS = 256

export type RelatedIssue = { number: number; relation: 'closes' | 'refs'; reason: string }

export type PullRequestInput = {
  title: string
  summary: string
  impact: string
  relatedIssues: RelatedIssue[]
  details: string[]
  base: string
  agent: string
  model?: string
  mode: (typeof PR_MODES)[number]
  workspaceSetup: string
}

/** A positive integer argument, such as a pull request number or an issue number. */
export function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new Error(`${label} must be a positive integer`)
  return value
}

function readRelatedIssues(args: Args): RelatedIssue[] {
  const value = args.relatedIssues
  if (!Array.isArray(value)) throw new Error('relatedIssues is required and must be an array')
  return value.map((item: unknown, index) => {
    const issue = requireObject(item)
    rejectUnknown(issue, ['number', 'relation', 'reason'])
    return {
      number: positiveInteger(issue.number, `relatedIssues[${index}].number`),
      relation: requiredChoice(issue, 'relation', RELATIONS),
      reason: requiredString(issue, 'reason'),
    }
  })
}

/** Reads and validates the structured pull request fields shared by the three pr_* tools. */
export function readPullRequestInput(args: Args): PullRequestInput {
  const title = requiredString(args, 'title')
  if (/[\r\n]/.test(title)) throw new Error('title must be a single line')
  if (Array.from(title).length > MAX_TITLE_CHARACTERS)
    throw new Error(`title must be at most ${MAX_TITLE_CHARACTERS} characters`)
  const model = optionalString(args, 'model')
  return {
    title,
    summary: requiredString(args, 'summary'),
    impact: requiredString(args, 'impact'),
    relatedIssues: readRelatedIssues(args),
    details: requiredStringArray(args, 'details'),
    base: optionalString(args, 'base') ?? 'main',
    agent: requiredString(args, 'agent'),
    ...(model === undefined ? {} : { model }),
    mode: requiredChoice(args, 'mode', PR_MODES),
    workspaceSetup: requiredString(args, 'workspaceSetup'),
  }
}
