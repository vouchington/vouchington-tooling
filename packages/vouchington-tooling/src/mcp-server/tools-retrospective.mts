import {
  type ToolDefinition,
  ADDITIVE,
  COVERAGE,
  IDENTITY,
  IDENTITY_REQUIRED,
  ID_PATTERN,
  OUTCOMES,
  READ_ONLY,
  tool,
} from './tools-schema.mts'

export const RETROSPECTIVE_TOOLS: readonly ToolDefinition[] = [
  tool(
    'retrospective_check',
    'Reports whether the session already holds a retrospective: { sessionId, saved, entries } ' +
      'where each entry is { sourceEventId, timestamp, issues, prs } for an entry of type ' +
      'retrospective, oldest first. sourceEventId narrows the result. A session that was never ' +
      'created reports saved: false.',
    READ_ONLY,
    { sourceEventId: { type: 'string', pattern: ID_PATTERN, description: 'Only this event id.' } },
  ),
  tool(
    'retrospective_save',
    'Saves the session retrospective after the checkout policy accepts it, and returns the same ' +
      'verified receipt as journal_append (status, receipt, timestamp, pendingCount, ' +
      'worktreePendingCount) plus policy.warnings. Pass exactly one of markdown (a finished ' +
      'document opening with the front matter composeRetrospective writes: date, issues, prs ' +
      'and optionally session_id, description, work_outcome, feedback_coverage, repositories, ' +
      'each line key: <JSON>; any that repeat an argument must equal it) or compose (the retrospective ' +
      'composer input: narrative, date, issues, prs, description, facts, transcript, tools, ' +
      'architecture, optional knownSensitiveValues; the server adds the rest). compose.transcript ' +
      'takes only { sessionId?, harnessSessionId? } (sessionId must be the call sessionId; the ' +
      'transcript is found by harnessSessionId, the harness session UUID, else by sessionId when ' +
      'that is a UUID, in the default session roots of the worktree) or { status, reason } to report it ' +
      'unassessed; any path override is rejected. The server redacts its blackboard token and ' +
      'knownSensitiveValues (also accepted beside markdown, not beside compose) from the ' +
      'document, category and feedbackCoverage before the policy sees them. dryRun returns ' +
      '{ markdown, previewToken, policy: { warnings } } and writes nothing; the previewToken is ' +
      'opaque, single use, held in server memory (a restart drops it) and bound to the sessionId, ' +
      'worktree and sourceEventId. To save exactly the previewed content, call again with ' +
      'previewToken, the identity, mode and the same sourceEventId, and no markdown, compose, ' +
      'workOutcome, feedbackCoverage, repositories, category or knownSensitiveValues. The ' +
      'policy is not run again for a token save. The worktree package.json may ' +
      'declare "vouchington-tooling": { "policy": "<module>" }; its validateRetrospective export ' +
      'runs in a child process, and any error it reports rejects the save with nothing written. ' +
      'Policy tools need a server launched inside a repository worktree. The server owns the ' +
      'timestamp. sourceEventId defaults to retrospective-<sessionId> (retrospective-<sha256 hex of the ' +
      'sessionId> when that exceeds 256 bytes); saving changed content ' +
      'under the same sourceEventId is an event-conflict, so a revision needs a new ' +
      'sourceEventId. Repeat an identical markdown call to retry. compose regenerates the document, ' +
      'so deliver a retained compose save with outbox_flush instead of repeating it. Counts ' +
      'follow journal_append.',
    ADDITIVE,
    {
      ...IDENTITY,
      mode: { enum: ['interactive', 'autonomous'], description: 'Delivery mode.' },
      workOutcome: {
        enum: OUTCOMES,
        description: 'Outcome of the work being reported; required without previewToken.',
      },
      feedbackCoverage: COVERAGE,
      repositories: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        description:
          'Exact owner/name repositories; stored sorted, deduplicated and lowercase. Default: ' +
          'the front matter repositories, else the policy pullRequestDefaults repositories; ' +
          'an error when none.',
      },
      markdown: { type: 'string', description: 'Finished retrospective markdown.' },
      compose: { type: 'object', description: 'Composer input; exclusive with markdown.' },
      sourceEventId: { type: 'string', pattern: ID_PATTERN, description: 'Stable event id.' },
      category: { type: 'string', description: 'Optional context; never changes entry type.' },
      dryRun: { type: 'boolean', description: 'Compose and validate only; write nothing.' },
      knownSensitiveValues: {
        type: 'array',
        items: { type: 'string', minLength: 4 },
        description: 'Values redacted from every argument of a markdown save.',
      },
      previewToken: {
        type: 'string',
        description:
          'Token from a dry run; saves exactly that content. Exclusive with the content.',
      },
    },
    // workOutcome and feedbackCoverage are required unless previewToken carries them.
    [...IDENTITY_REQUIRED, 'mode'],
  ),
]
