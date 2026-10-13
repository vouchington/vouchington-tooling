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

function readDetails(args: Args): string[] {
  const details = requiredStringArray(args, 'details')
  details.forEach((detail, index) => {
    if (!detail.trim()) throw new Error(`details[${index}] must not be empty`)
  })
  return details
}

/** Rechecked after redaction, which can lengthen a title. */
export function checkTitleLength(title: string): void {
  if (Array.from(title).length > MAX_TITLE_CHARACTERS)
    throw new Error(`title must be at most ${MAX_TITLE_CHARACTERS} characters`)
}

function singleLine(args: Args, key: string): string {
  const value = requiredString(args, key)
  if (/[\r\n]/.test(value)) throw new Error(`${key} must be a single line`)
  return value
}

/** Reads and validates the structured pull request fields shared by the three pr_* tools. */
export function readPullRequestInput(args: Args): PullRequestInput {
  const title = singleLine(args, 'title')
  checkTitleLength(title)
  const model = optionalString(args, 'model')
  return {
    title,
    summary: requiredString(args, 'summary'),
    impact: requiredString(args, 'impact'),
    relatedIssues: readRelatedIssues(args),
    details: readDetails(args),
    base: optionalString(args, 'base') ?? 'main',
    agent: requiredString(args, 'agent'),
    ...(model === undefined ? {} : { model }),
    mode: requiredChoice(args, 'mode', PR_MODES),
    // It renders on its own provenance line; a newline would forge the lines after it.
    workspaceSetup: singleLine(args, 'workspaceSetup'),
  }
}
