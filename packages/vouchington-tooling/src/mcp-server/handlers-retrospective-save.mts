import { createHash } from 'node:crypto'
import { createFeedbackEnvelope, validateFeedbackEnvelope } from '../agent-blackboard/index.mts'
import {
  optionalRecord,
  optionalString,
  requiredChoice,
  requiredString,
  requiredStringArray,
  type Args,
} from './args.mts'
import { assertPolicyAllowed, readIdentity, type ToolHandler } from './context.mts'
import { MODES, OUTCOMES, readCoverage } from './handlers-journal.mts'
import { runValidator, type PolicyRun } from './policy-run.mts'
import { previewRegistry } from './preview-registry.mts'
import { deliver, saveFromPreview } from './retrospective-preview.mts'
import { parseRetrospectiveFrontMatter } from './retrospective-front-matter.mts'
import {
  FEEDBACK_MARKDOWN_MAX_BYTES,
  redactFeedbackText,
} from '../agent-blackboard/feedback-codec.mts'
import { composeFromArgs, sensitiveValues } from './retrospective-input.mts'
import { checkFrontMatter, resolveRepositories } from './retrospective-resolve.mts'

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
  const sourceEventId =
    optionalString(args, 'sourceEventId') ?? defaultSourceEventId(context.sessionId)
  if (args.previewToken !== undefined)
    return saveFromPreview(args, context, identity, mode, sourceEventId)
  const workOutcome = requiredChoice(args, 'workOutcome', OUTCOMES)
  const feedbackCoverage = readCoverage(args)
  const argRepositories =
    args.repositories === undefined ? undefined : requiredStringArray(args, 'repositories')
  const category = optionalString(args, 'category')
  if (args.dryRun !== undefined && typeof args.dryRun !== 'boolean')
    throw new Error('dryRun must be a boolean')
  const policy: Omit<PolicyRun, 'export' | 'input'> = {
    worktree: context.worktree,
    env: context.env,
    ...(context.spawnPolicy === undefined ? {} : { spawn: context.spawnPolicy }),
  }
  const { markdown: given, compose } = readMarkdownSource(args)
  if (compose !== undefined && args.knownSensitiveValues !== undefined)
    throw new Error('with compose, pass knownSensitiveValues inside compose')
  // A markdown save redacts every argument with the same values a compose save would.
  const secrets = sensitiveValues(
    compose ?? { knownSensitiveValues: args.knownSensitiveValues },
    context.env,
  )
  // Everything the policy sees is derived from the redacted document, never the raw input.
  const redactedGiven = given === undefined ? undefined : redactFeedbackText(given, secrets)
  // Reject a document that can never be stored before any policy export runs for it.
  if (redactedGiven !== undefined && Buffer.byteLength(redactedGiven) > FEEDBACK_MARKDOWN_MAX_BYTES)
    throw new Error(`markdown must be at most ${FEEDBACK_MARKDOWN_MAX_BYTES} bytes`)
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
    // The document was redacted before parsing, so compare it with equally redacted sources.
    feedbackCoverage: {
      ...feedbackCoverage,
      sources: feedbackCoverage.sources.map((source) => redactFeedbackText(source, secrets)),
    },
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
  if (args.dryRun === true) {
    const previewToken = previewRegistry.put({
      sessionId: context.sessionId,
      parentSessionId: identity.parentSessionId,
      mode,
      worktree: context.worktree,
      sourceEventId,
      envelope,
      warnings,
    })
    return { markdown: envelope.markdown, previewToken, policy: { warnings } }
  }
  return { ...(await deliver(envelope, identity, mode, context)), policy: { warnings } }
}
