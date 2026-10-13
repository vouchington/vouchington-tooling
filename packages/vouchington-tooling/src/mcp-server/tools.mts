import {
  ADDITIVE,
  AGENT,
  COVERAGE,
  IDEMPOTENT_ADDITIVE,
  IDENTITY,
  IDENTITY_REQUIRED,
  ID_PATTERN,
  MUTATING,
  OUTCOMES,
  PARENT_SESSION_ID,
  READ_ONLY,
  type ToolDefinition,
  VERSION,
  tool,
} from './tools-schema.mts'
import { RETROSPECTIVE_TOOLS } from './tools-retrospective.mts'

export const TOOLS: readonly ToolDefinition[] = [
  tool(
    'journal_append',
    'Appends one journal entry to the caller session and returns the verified read-back receipt. ' +
      'Nothing is written unless every required field validates. Interactive mode retains the ' +
      'envelope in the worktree outbox when the blackboard is unreachable. The server owns the ' +
      'entry timestamp and returns it. An event is identified by sessionId, sourceEventId, and ' +
      'content, never by timestamp: to retry, repeat the identical call, and a retry of an ' +
      'event already stored or retained reports the stored timestamp instead of a new one. The ' +
      'same sourceEventId with different content is an event-conflict. pendingCount counts ' +
      'unsent records of the caller sessionId; worktreePendingCount counts those of every ' +
      'session in the worktree outbox (both 0 in autonomous mode, which never uses an outbox).',
    ADDITIVE,
    {
      ...IDENTITY,
      mode: { enum: ['interactive', 'autonomous'], description: 'Delivery mode.' },
      markdown: { type: 'string', description: 'Journal note as markdown text (max 12000 bytes).' },
      sourceEventId: { type: 'string', pattern: ID_PATTERN, description: 'Stable event id.' },
      workOutcome: { enum: OUTCOMES, description: 'Outcome of the work being reported.' },
      repositories: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        description: 'Exact owner/name repositories this entry concerns.',
      },
      feedbackCoverage: COVERAGE,
      category: { type: 'string', description: 'Optional context; never changes entry type.' },
    },
    [
      ...IDENTITY_REQUIRED,
      'mode',
      'markdown',
      'sourceEventId',
      'workOutcome',
      'repositories',
      'feedbackCoverage',
    ],
  ),
  tool(
    'journal_entries',
    'Returns every entry of one session, oldest first, as JSON: { sessionId, entries }. Each ' +
      'entry is exactly as the blackboard returns it ({ sessionId, createdAt, data }), including ' +
      'non-journal types such as retrospective and legacy entries without a feedback envelope.',
    READ_ONLY,
  ),
  tool(
    'outbox_status',
    'Reports unsent journal records in the worktree outbox. pendingCount and status (empty or ' +
      'pending) cover the caller sessionId only; worktreePendingCount covers every session. ' +
      'rejectedCount (and worktreeRejectedCount) counts permanently rejected records kept aside.',
    READ_ONLY,
  ),
  tool(
    'outbox_flush',
    'Delivers every retained record in the worktree outbox, whichever session wrote it, and ' +
      'returns deliveredCount for the whole flush. pendingCount and status cover the remaining ' +
      'records of the caller sessionId; worktreePendingCount covers every session. ' +
      'A record with a permanent rejection moves to the rejected area and is listed in rejected ' +
      'as sourceEventId and diagnostic.',
    IDEMPOTENT_ADDITIVE,
  ),
  tool(
    'session_ensure',
    'Idempotently creates a session, or verifies that an existing one has the same identity. ' +
      'Returns the session id and whether it was created.',
    IDEMPOTENT_ADDITIVE,
    IDENTITY,
    IDENTITY_REQUIRED,
  ),
  ...RETROSPECTIVE_TOOLS,
  tool(
    'snapshot_export',
    'Exports non-archived sessions into a private local JSONL file chosen by the blackboard ' +
      'client. Returns the path, counts, checksum, manifest, and cleanupToken; never the records. ' +
      'sessionId identifies the caller.',
    ADDITIVE,
    {
      agent: AGENT,
      version: VERSION,
      parentSessionId: PARENT_SESSION_ID,
      data: { type: 'object', description: 'Top-level session data fields to match exactly.' },
      dataArrayContains: { type: 'object', description: 'Exact string membership in arrays.' },
      inactiveForHours: { type: 'number', exclusiveMinimum: 0 },
    },
  ),
  tool(
    'session_archive',
    'Marks a session as distilled. Its metadata becomes immutable; entries stay appendable.',
    MUTATING,
  ),
]
