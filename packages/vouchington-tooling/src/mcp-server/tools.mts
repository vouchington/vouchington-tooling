type JsonSchema = Record<string, unknown>

export type ToolDefinition = {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, JsonSchema>
    required: string[]
    additionalProperties: false
  }
  annotations: {
    readOnlyHint: boolean
    destructiveHint: boolean
    idempotentHint: boolean
    openWorldHint: boolean
  }
}

const ID_PATTERN = '^[A-Za-z0-9._:-]+$'

const SESSION_ID: JsonSchema = {
  type: 'string',
  pattern: ID_PATTERN,
  maxLength: 256,
  description: 'Explicit session id (URL-safe). Never inferred by the server.',
}
const WORKTREE: JsonSchema = {
  type: 'string',
  description:
    'Absolute path of the top level of a git worktree (`git rev-parse --show-toplevel`), not a ' +
    'subdirectory. Defaults to the launch directory worktree; required when the server was ' +
    'launched outside a git worktree.',
}
const PARENT_SESSION_ID: JsonSchema = {
  type: ['string', 'null'],
  pattern: ID_PATTERN,
  maxLength: 256,
  description: 'Direct parent session id, or null for a root session.',
}
const AGENT: JsonSchema = { type: 'string', maxLength: 128, description: 'Agent name.' }
const VERSION: JsonSchema = { type: 'string', maxLength: 128, description: 'Agent version.' }
const OUTCOMES = [
  'in-progress',
  'success',
  'failure',
  'cancelled',
  'timed-out',
  'no-change',
  'policy-refusal',
  'unknown',
]
const COVERAGE_STATUSES = ['complete', 'partial', 'unavailable', 'not-assessed', 'not-started']

const READ_ONLY = flags(true, false, true)
const ADDITIVE = flags(false, false, false)
const IDEMPOTENT_ADDITIVE = flags(false, false, true)
const MUTATING = flags(false, true, true)

function flags(readOnly: boolean, destructive: boolean, idempotent: boolean) {
  return {
    readOnlyHint: readOnly,
    destructiveHint: destructive,
    idempotentHint: idempotent,
    openWorldHint: false,
  }
}

function tool(
  name: string,
  description: string,
  annotations: ToolDefinition['annotations'],
  properties: Record<string, JsonSchema> = {},
  required: string[] = [],
): ToolDefinition {
  return {
    name,
    description,
    inputSchema: {
      type: 'object',
      properties: { sessionId: SESSION_ID, worktree: WORKTREE, ...properties },
      required: ['sessionId', ...required],
      additionalProperties: false,
    },
    annotations,
  }
}

const IDENTITY = { parentSessionId: PARENT_SESSION_ID, agent: AGENT, version: VERSION }
const IDENTITY_REQUIRED = ['parentSessionId', 'agent', 'version']

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
      feedbackCoverage: {
        type: 'object',
        properties: {
          status: { enum: COVERAGE_STATUSES },
          sources: { type: 'array', items: { type: 'string' } },
          droppedCount: { type: 'integer', minimum: 0 },
        },
        required: ['status'],
        additionalProperties: false,
        description: 'Explicit coverage; sources default to [] and droppedCount to 0.',
      },
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
