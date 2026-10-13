import { createHash } from 'node:crypto'
import {
  createFeedbackEnvelope,
  validateFeedbackEnvelope,
  writeFeedback,
} from '../agent-blackboard/index.mts'
import {
  optionalRecord,
  optionalString,
  requiredChoice,
  requiredString,
  requiredStringArray,
  type Args,
} from './args.mts'
import { assertPolicyAllowed, outboxDirectory, readIdentity, type ToolHandler } from './context.mts'
import {
  byCreatedAt,
  deliveryResponse,
  MODES,
  OUTCOMES,
  readCoverage,
} from './handlers-journal.mts'
import { readEntriesIfPresent } from './journal-read.mts'
import { runValidator, type PolicyRun } from './policy-run.mts'
import { parseRetrospectiveFrontMatter } from './retrospective-front-matter.mts'
import { redactFeedbackText } from '../agent-blackboard/feedback-codec.mts'
import { composeFromArgs, sensitiveValues } from './retrospective-input.mts'
import { checkFrontMatter, resolveRepositories } from './retrospective-resolve.mts'

type Data = { type?: unknown; sourceEventId?: unknown; timestamp?: unknown }

function retrospectiveData(entry: unknown): (Data & Record<string, unknown>) | undefined {
  const data = (entry as { data?: unknown } | null)?.data as Data | null | undefined
  return data?.type === 'retrospective' ? (data as Data & Record<string, unknown>) : undefined
}

/** Whether the session already holds a retrospective, and which (sourceEventId, issues, prs). */
export const retrospectiveCheck: ToolHandler = async (args, context) => {
  const sourceEventId = optionalString(args, 'sourceEventId')
  const entries = await readEntriesIfPresent(context.sessionId, context.env, context.dependencies)
  const found = (entries ?? [])
    .toSorted(byCreatedAt)
    .flatMap((entry) => {
      const data = retrospectiveData(entry)
      return data === undefined ? [] : [data]
    })
    .filter((data) => sourceEventId === undefined || data.sourceEventId === sourceEventId)
    .map((data) => ({
      sourceEventId: data.sourceEventId,
      timestamp: data.timestamp,
      issues: data.issues ?? [],
      prs: data.prs ?? [],
    }))
  return { sessionId: context.sessionId, saved: found.length > 0, entries: found }
}

function readMarkdownSource(args: Args): { markdown?: string; compose?: Args } {
  const compose = optionalRecord(args, 'compose')
  if ((args.markdown === undefined) === (compose === undefined))
    throw new Error('pass exactly one of markdown or compose')
  return compose === undefined ? { markdown: requiredString(args, 'markdown') } : { compose }
}

/** The default event id, hashed when the session id would push it past the 256-byte limit. */
export function defaultSourceEventId(sessionId: string): string {
  const id = `retrospective-${sessionId}`
  return Buffer.byteLength(id) <= 256
    ? id
    : `retrospective-${createHash('sha256').update(sessionId).digest('hex')}`
}

/**
 * Saves the session's retrospective: composes it when `compose` is given, checks the arguments
 * against the document's front matter, runs the checkout's `validateRetrospective` policy (in a
 * child process) and writes nothing if it reports errors, then writes through the same verified
 * path as `journal_append`.
 */
export const retrospectiveSave: ToolHandler = async (args, context) => {
  assertPolicyAllowed(context)
  const identity = readIdentity(args, context.sessionId)
  const mode = requiredChoice(args, 'mode', MODES)
  const workOutcome = requiredChoice(args, 'workOutcome', OUTCOMES)
  const feedbackCoverage = readCoverage(args)
  const argRepositories =
    args.repositories === undefined ? undefined : requiredStringArray(args, 'repositories')
  const sourceEventId =
    optionalString(args, 'sourceEventId') ?? defaultSourceEventId(context.sessionId)
  const category = optionalString(args, 'category')
  if (args.dryRun !== undefined && typeof args.dryRun !== 'boolean')
    throw new Error('dryRun must be a boolean')
  const policy: Omit<PolicyRun, 'export' | 'input'> = {
    worktree: context.worktree,
    env: context.env,
    ...(context.spawnPolicy === undefined ? {} : { spawn: context.spawnPolicy }),
  }
  const { markdown: given, compose } = readMarkdownSource(args)
  const secrets = sensitiveValues(compose, context.env)
  // Everything the policy sees is derived from the redacted document, never the raw input.
  const redactedGiven = given === undefined ? undefined : redactFeedbackText(given, secrets)
  const early =
    redactedGiven === undefined ? undefined : parseRetrospectiveFrontMatter(redactedGiven)
  const repositories = await resolveRepositories(argRepositories, early?.repositories, policy)
  const markdown =
    redactedGiven ??
    redactFeedbackText(
      await composeFromArgs(compose as Args, {
        sessionId: context.sessionId,
        repositories,
        workOutcome,
        feedbackCoverage,
        worktree: context.worktree,
        env: context.env,
        dependencies: context.dependencies,
      }),
      secrets,
    )
  const front = early ?? parseRetrospectiveFrontMatter(markdown)
  checkFrontMatter(front, {
    sessionId: context.sessionId,
    workOutcome,
    feedbackCoverage,
    repositories: argRepositories,
  })
  // Building the envelope first rejects empty or oversized markdown before any policy runs.
  const envelope = createFeedbackEnvelope(
    {
      schemaVersion: 1,
      type: 'retrospective',
      sourceEventId,
      // The server owns the timestamp, as in journal_append.
      timestamp: new Date().toISOString(),
      date: front.date,
      issues: front.issues,
      prs: front.prs,
      repositories,
      markdown,
      workOutcome,
      feedbackCoverage,
      ...(category === undefined ? {} : { category }),
    },
    { knownSensitiveValues: secrets },
  )
  const redactedFront = parseRetrospectiveFrontMatter(envelope.markdown)
  validateFeedbackEnvelope(envelope)
  const report = await runValidator({
    ...policy,
    export: 'validateRetrospective',
    input: {
      sessionId: context.sessionId,
      parentSessionId: identity.parentSessionId,
      mode,
      workOutcome,
      // The envelope's copy, which is redacted like the markdown.
      feedbackCoverage: envelope.feedbackCoverage,
      repositories,
      markdown: envelope.markdown,
      sourceEventId,
      metadata: {
        date: redactedFront.date,
        issues: redactedFront.issues,
        prs: redactedFront.prs,
        description: redactedFront.description,
      },
    },
  })
  if ('errors' in report && report.errors.length)
    throw new Error(`policy rejected the retrospective:\n- ${report.errors.join('\n- ')}`)
  const warnings = 'warnings' in report ? report.warnings : []
  if (args.dryRun === true) return { markdown: envelope.markdown, policy: { warnings } }
  const directory = mode === 'interactive' ? outboxDirectory(context.worktree) : undefined
  const result = await writeFeedback({
    identity,
    envelope,
    mode,
    ...(directory === undefined ? {} : { outboxDirectory: directory }),
    env: context.env,
    dependencies: context.dependencies,
  })
  return { ...deliveryResponse(result, context, mode), policy: { warnings } }
}
