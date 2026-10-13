import {
  type JsonSchema,
  type ToolDefinition,
  ADDITIVE,
  MUTATING,
  READ_ONLY,
  tool,
} from './tools-schema.mts'

const text = (description: string): JsonSchema => ({ type: 'string', minLength: 1, description })
const PR_NUMBER: JsonSchema = { type: 'integer', minimum: 1, description: 'Pull request number.' }

const FIELDS: Record<string, JsonSchema> = {
  title: { type: 'string', minLength: 1, maxLength: 256, description: 'Single-line PR title.' },
  summary: text('What the change does, as markdown.'),
  impact: text('Who or what is affected, as markdown.'),
  relatedIssues: {
    type: 'array',
    description: 'Issues this pull request closes or refs; may be empty.',
    items: {
      type: 'object',
      properties: {
        number: { type: 'integer', minimum: 1 },
        relation: { enum: ['closes', 'refs'] },
        reason: text('Why the issue is related.'),
      },
      required: ['number', 'relation', 'reason'],
      additionalProperties: false,
    },
  },
  details: {
    type: 'array',
    minItems: 1,
    items: { type: 'string', minLength: 1 },
    description: 'Markdown paragraphs or bullets, joined by blank lines.',
  },
  base: { type: 'string', minLength: 1, description: 'Base branch. Default: main.' },
  agent: text('Agent name for the Agent line.'),
  model: text('Optional model name, rendered in parentheses after the agent.'),
  mode: { enum: ['interactive', 'autonomous'], description: 'Delivery mode, given to the policy.' },
  workspaceSetup: text('Text for the Workspace setup line, such as how the worktree was prepared.'),
}
const REQUIRED = [
  'title',
  'summary',
  'impact',
  'relatedIssues',
  'details',
  'agent',
  'mode',
  'workspaceSetup',
]

const RENDERING =
  'The server renders the body from the structured input (Summary, Impact, Related issues, ' +
  'Details, then Workspace setup, Agent, Device and Worktree lines) and runs the checkout ' +
  'policy validatePullRequest export in a child process; the head branch is the ' +
  "worktree's current branch. Policy tools need a server launched inside a repository worktree. "

export const PR_TOOLS: readonly ToolDefinition[] = [
  tool(
    'pr_validate',
    'Renders the pull request body and validates it with the checkout policy; writes nothing. ' +
      RENDERING +
      'Pass pr to validate an update of that pull request: the live body is read and its Shepherd ' +
      'Journal preserved. Returns { body, errors, warnings }.',
    READ_ONLY,
    { ...FIELDS, pr: PR_NUMBER },
    REQUIRED,
  ),
  tool(
    'pr_create',
    'Creates a draft pull request from the worktree branch. ' +
      RENDERING +
      'Validation errors block creation. The policy pullRequestDefaults export may add labels, a ' +
      'milestone and a project. The branch must already be pushed and current. Returns ' +
      '{ number, url, warnings }.',
    ADDITIVE,
    FIELDS,
    REQUIRED,
  ),
  tool(
    'pr_update',
    "Replaces an open pull request's title and body. " +
      RENDERING +
      "The pull request's head branch must be the worktree branch. The live Shepherd Journal is " +
      'preserved and nothing else is carried over from the live body. Validation errors block ' +
      'the update. Returns { number, url, warnings }.',
    MUTATING,
    { ...FIELDS, pr: PR_NUMBER },
    [...REQUIRED, 'pr'],
  ),
]
