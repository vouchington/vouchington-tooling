export type JsonSchema = Record<string, unknown>

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

export const ID_PATTERN = '^[A-Za-z0-9._:-]+$'

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
export const PARENT_SESSION_ID: JsonSchema = {
  type: ['string', 'null'],
  pattern: ID_PATTERN,
  maxLength: 256,
  description: 'Direct parent session id, or null for a root session.',
}
export const AGENT: JsonSchema = { type: 'string', maxLength: 128, description: 'Agent name.' }
export const VERSION: JsonSchema = { type: 'string', maxLength: 128, description: 'Agent version.' }
export const OUTCOMES = [
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

export const COVERAGE: JsonSchema = {
  type: 'object',
  properties: {
    status: { enum: COVERAGE_STATUSES },
    sources: { type: 'array', items: { type: 'string' } },
    droppedCount: { type: 'integer', minimum: 0 },
  },
  required: ['status'],
  additionalProperties: false,
  description: 'Explicit coverage; sources default to [] and droppedCount to 0.',
}

export const READ_ONLY = flags(true, false, true)
export const ADDITIVE = flags(false, false, false)
export const IDEMPOTENT_ADDITIVE = flags(false, false, true)
export const MUTATING = flags(false, true, true)

function flags(readOnly: boolean, destructive: boolean, idempotent: boolean) {
  return {
    readOnlyHint: readOnly,
    destructiveHint: destructive,
    idempotentHint: idempotent,
    openWorldHint: false,
  }
}

export function tool(
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

export const IDENTITY = { parentSessionId: PARENT_SESSION_ID, agent: AGENT, version: VERSION }
export const IDENTITY_REQUIRED = ['parentSessionId', 'agent', 'version']
