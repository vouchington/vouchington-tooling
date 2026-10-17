import {
  type JsonSchema,
  type ToolDefinition,
  ADDITIVE,
  MUTATING,
  READ_ONLY,
  tool,
} from './tools-schema.mts'

/** These tools read or write GitHub, outside the server's own state. */
const openWorld = (annotations: ToolDefinition['annotations']) => ({
  ...annotations,
  openWorldHint: true,
})
const text = (description: string): JsonSchema => ({ type: 'string', minLength: 1, description })
const PR_NUMBER: JsonSchema = { type: 'integer', minimum: 1, description: 'Pull request number.' }

const FIELDS: Record<string, JsonSchema> = {
  title: { type: 'string', minLength: 1, maxLength: 256, description: 'Single-line PR title.' },
  summary: text('What the change does, as markdown.'),
  impact: text('Who or what is affected, as markdown.'),
  relatedIssues: {
    type: 'array',
    description:
      'Issues this pull request closes or refs. Empty when it has none; with no source issue ' +
      'at all, give noSourceIssue as well (it is rejected beside a non-empty list).',
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
  noSourceIssue: {
    type: 'object',
    description:
      'Declares a pull request with no source issue, mutually exclusive with a non-empty ' +
      'relatedIssues. Rendered inside Related issues (the policy may supply the wording) and ' +
      'passed to the policy, which may allow it only in interactive mode.',
    properties: { reason: text('Single-line reason there is no source issue.') },
    required: ['reason'],
    additionalProperties: false,
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
  mode: {
    enum: ['interactive', 'autonomous'],
    description:
      'Optional. The server derives the mode from its own launch environment and fails closed: ' +
      'an automation marker (CI, GITHUB_ACTIONS and similar) means autonomous. This argument ' +
      'can only narrow interactive to autonomous, never widen it.',
  },
  workspaceSetup: text('Text for the Workspace setup line, such as how the worktree was prepared.'),
}
const REQUIRED = [
  'title',
  'summary',
  'impact',
  'relatedIssues',
  'details',
  'agent',
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
      'Journal preserved; the pull request may be in any state and on any head (the head given to ' +
      'the policy is its own, and no liveness check applies, unlike pr_update). Returns ' +
      '{ body, errors, warnings }.',
    openWorld(READ_ONLY),
    { ...FIELDS, pr: PR_NUMBER },
    REQUIRED,
  ),
  tool(
    'pr_create',
    'Creates a draft pull request from the worktree branch. ' +
      RENDERING +
      'Validation errors block creation. The policy pullRequestDefaults export may add labels, a ' +
      'milestone and a project. The branch must already be pushed and current. It sees no stack ' +
      'membership, so a policy may reject a non-default base; create stacked layers with the ' +
      "repository's stack tooling. Returns { number, url, warnings }.",
    openWorld(ADDITIVE),
    FIELDS,
    REQUIRED,
  ),
  tool(
    'pr_update',
    "Replaces an open pull request's title and body. " +
      RENDERING +
      "The pull request's head must be the worktree branch, or the worktree HEAD must be the pull request's head commit (an alias branch); the live head name is then used. The live Shepherd Journal is " +
      'preserved and nothing else is carried over from the live body. Validation errors block ' +
      'the update. Returns { number, url, warnings }.',
    openWorld(MUTATING),
    { ...FIELDS, pr: PR_NUMBER },
    [...REQUIRED, 'pr'],
  ),
]
