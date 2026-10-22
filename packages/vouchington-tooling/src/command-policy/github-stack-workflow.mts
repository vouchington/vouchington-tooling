import {
  findStackInitBaseBlock,
  type ResolvedStackPolicy,
  withGuidance,
} from './github-configured-base.mts'
import type { GhInvocation } from './github-invocation.mts'
import { hasNamedFlag, hasNumericPrSelector } from './github-option-flags.mts'
import type { BlockDecision } from './types.mts'

const STACK_AGENT_ACTIONS = new Set([
  'add',
  'bottom',
  'checkout',
  'delete',
  'down',
  'init',
  'link',
  'merge',
  'push',
  'rebase',
  'submit',
  'sync',
  'top',
  'unstack',
  'up',
  'view',
])

const HELP_FLAGS = new Set(['--help', '-h'])

/**
 * `cwd` is the invocation's working directory, or undefined when it could not be determined (an
 * unresolved `cd` target). The init HEAD-ancestry guard fails open in that case rather than
 * substitute the session cwd.
 */
export function findGitHubStackWorkflowBlock(
  invocation: GhInvocation,
  cwd: string | undefined,
  policy: ResolvedStackPolicy,
): BlockDecision | null {
  const stack = stackInvocation(invocation)
  if (stack === null || isStackHelp(stack)) {
    return null
  }
  const block = (reason: string): BlockDecision => ({
    reason: withGuidance(reason, policy.guidance),
  })
  const { action, optionTokens } = stack
  const draftFirst = `New PRs must be opened as draft first.`
  const followUp = policy.draftFollowUp === '' ? '' : `, then ${policy.draftFollowUp}`

  if (!STACK_AGENT_ACTIONS.has(action)) {
    return block(
      'gh stack allowlist is closed. Use only the non-interactive commands. Interactive TUIs (modify, switch) and trunk are banned.',
    )
  }
  if (action === 'init') {
    return findStackInitBaseBlock(optionTokens, cwd, policy)
  }
  if (action === 'checkout') {
    return isStackCheckoutTarget(optionTokens)
      ? null
      : block(
          'gh stack checkout takes exactly one stack number or PR number: `gh stack checkout <stack-number>`. The bare form is an interactive picker, and a branch-name target resolves only against stacks this worktree already tracks.',
        )
  }
  if (action === 'submit') {
    if (hasNamedFlag(optionTokens, 'open')) {
      return block(`${draftFirst} Use \`gh stack submit --auto\`${followUp}.`)
    }
    return hasNamedFlag(optionTokens, 'auto')
      ? null
      : block(
          'gh stack submit is an interactive TUI. Use `gh stack submit --auto` so new stacked PRs open as drafts.',
        )
  }
  if (action === 'link' && hasNamedFlag(optionTokens, 'open')) {
    return block(`${draftFirst} Use \`gh stack link\` without --open${followUp}.`)
  }
  // Merge authority itself belongs to findAutomationMergeBlock and findInteractiveMergeConfirm.
  if (action === 'merge' && !hasNumericPrSelector(optionTokens)) {
    return block(
      'gh stack merge requires a PR-number selector. Bare merge is a TUI and lands the whole stack. Use `gh stack merge --squash <pr>`.',
    )
  }
  return null
}

// Exactly one positive stack or PR number. The bare form opens a picker, and gh-stack resolves a
// branch name only against stacks this worktree already tracks.
function isStackCheckoutTarget(optionTokens: string[]): boolean {
  return optionTokens.length === 1 && /^[1-9]\d*$/.test(optionTokens[0]!)
}

// gh-stack is a cobra CLI. Its root command only prints help, `help [command]` only prints help,
// and `--help` or `-h` prints a command's help and exits before the command runs. Only the bare
// forms count, since a `--` or any other argument beside the flag can change what runs.
function isStackHelp({ action, optionTokens }: GhInvocation): boolean {
  if (HELP_FLAGS.has(action) || action === 'help') {
    return (
      optionTokens.length === 0 ||
      (action === 'help' && optionTokens.length === 1 && STACK_AGENT_ACTIONS.has(optionTokens[0]!))
    )
  }
  return (
    STACK_AGENT_ACTIONS.has(action) && optionTokens.length === 1 && HELP_FLAGS.has(optionTokens[0]!)
  )
}

const EXTENSION_AREAS = new Set(['extension', 'extensions', 'ext'])

function stackInvocation(invocation: GhInvocation): GhInvocation | null {
  if (invocation.area === 'stack') {
    return invocation
  }
  const action = invocation.optionTokens[1]
  if (
    EXTENSION_AREAS.has(invocation.area) &&
    invocation.action === 'exec' &&
    invocation.optionTokens[0] === 'stack' &&
    action !== undefined
  ) {
    return { ...invocation, action, area: 'stack', optionTokens: invocation.optionTokens.slice(2) }
  }
  return null
}
