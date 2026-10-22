import { tokenizeShellWordsDetailed } from '../shell-parse/index.mts'
import { commandsToInspectForGitHubPolicy } from './github-command-context.mts'
import { commandCwd } from './github-command-cwd.mts'
import { commandPrefixAt } from './github-command-position.mts'
import { defaultGitProbe } from './git-process.mts'
import type { ResolvedStackPolicy } from './github-configured-base.mts'
import { parseGhOrGhStackInvocation } from './github-invocation.mts'
import { findAutomationMergeBlock } from './github-merge-authority.mts'
import { findGitHubStackWorkflowBlock } from './github-stack-workflow.mts'
import type { BlockDecision, StackPolicy } from './types.mts'

export type GitHubWorkflowPolicy = {
  automationContext: boolean
  mergeGuidance?: string | undefined
  stack?: StackPolicy | undefined
}

function resolveStackPolicy(stack: StackPolicy): ResolvedStackPolicy {
  return {
    baseBranch: stack.baseBranch ?? 'main',
    remote: stack.remote ?? 'origin',
    guidance: stack.guidance ?? '',
    draftFollowUp: stack.draftFollowUp ?? '',
    git: stack.git ?? defaultGitProbe,
  }
}

export function findGitHubWorkflowBlock(
  command: string,
  cwd: string,
  policy: GitHubWorkflowPolicy,
): BlockDecision | null {
  const stackBlock =
    policy.stack === undefined
      ? null
      : findStackBlock(command, cwd, resolveStackPolicy(policy.stack))
  // The specific reasons win; any other merge in automation gets the coarse block.
  return (
    stackBlock ??
    findAutomationMergeBlock(command, policy.automationContext, policy.mergeGuidance ?? '')
  )
}

function findStackBlock(
  command: string,
  cwd: string,
  stack: ResolvedStackPolicy,
): BlockDecision | null {
  for (const commandToInspect of commandsToInspectForGitHubPolicy(command)) {
    const tokens = tokenizeShellWordsDetailed(commandToInspect, { splitRedirections: true }).map(
      (token) => token.value,
    )
    for (let index = 0; index < tokens.length; index += 1) {
      if (!mayRunGh(tokens[index]!) || commandPrefixAt(tokens, index) === null) {
        continue
      }
      const invocation = parseGhOrGhStackInvocation(tokens, index)
      if (invocation === null) {
        continue
      }
      const block = findGitHubStackWorkflowBlock(invocation, commandCwd(tokens, index, cwd), stack)
      if (block !== null) {
        return block
      }
    }
  }
  return null
}

// Every policy above reads a gh or gh-stack command. Skipping other words before commandPrefixAt
// keeps a long command from rescanning its segment at every word.
function mayRunGh(word: string): boolean {
  const name = word.slice(word.lastIndexOf('/') + 1)
  return name === 'gh' || name === 'gh-stack'
}
