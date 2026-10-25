import {
  commandsToInspectForGitPolicy,
  commandsToInspectPreservingQuotes,
  extractShellCommandSubstitutions,
  isInteractiveRebaseContinue,
} from '../shell-parse/index.mts'
import { findBlockedConfigReason, findBlockedPatternReason } from './git-patterns.mts'
import { findGitHubWorkflowBlock } from './github-workflow.mts'
import { findInteractiveMergeConfirm } from './github-merge-authority.mts'
import { extractToolCommand, hookCwd } from './payload.mts'
import { findPathTypo, referencesProtectedPath } from './path-rules.mts'
import type { BlockDecision, CommandPolicy, EvaluateOptions, HookPayload } from './types.mts'

/**
 * Decides whether a tool call may run under a caller-supplied rule table. Every check that can
 * block runs first; the interactive lone-merge confirm is the final return, so a block anywhere in
 * the command always beats the merge allow. Returns null when the policy has no opinion.
 */
export function evaluateCommandPolicy(
  payload: HookPayload,
  policy: CommandPolicy,
  options: EvaluateOptions = {},
): BlockDecision | null {
  const command = extractToolCommand(payload)
  const automationContext = options.automationContext ?? true

  const typo = findPathTypo(payload, command, policy.typoPaths ?? [])
  if (typo !== undefined) {
    return { reason: typo.reason }
  }
  if (
    automationContext &&
    policy.protectedPaths !== undefined &&
    referencesProtectedPath(payload, command, policy.protectedPaths)
  ) {
    return { reason: policy.protectedPaths.reason }
  }
  // An apply_patch payload is path-checked above and carries no shell to inspect.
  if (command === '' || command.startsWith('*** Begin Patch')) {
    return null
  }

  const workflowBlock = findGitHubWorkflowBlock(command, options.cwd ?? hookCwd(payload), {
    automationContext,
    mergeGuidance: policy.mergeGuidance,
    stack: policy.stack,
  })
  if (workflowBlock !== null) {
    return workflowBlock
  }
  return (
    findScriptBlock(command, policy) ??
    findInteractiveMergeConfirm(command, automationContext, policy.mergeGuidance ?? '')
  )
}

function findScriptBlock(command: string, policy: CommandPolicy): BlockDecision | null {
  const scripts = [...commandsToInspectForGitPolicy(command), ...quotedSubstitutionScripts(command)]
  for (const script of scripts) {
    const reason = findBlockedPatternReason(script, policy.commandPatterns ?? [])
    if (reason !== null) return { reason }
  }
  if (!/\bgit\b/.test(command)) {
    return null
  }
  for (const script of rawScripts(command)) {
    const reason = findBlockedConfigReason(script, policy.gitPatterns ?? [])
    if (reason !== null) return { reason }
  }
  for (const script of scripts) {
    if (policy.rebaseContinueReason !== undefined && isInteractiveRebaseContinue(script)) {
      return { reason: policy.rebaseContinueReason }
    }
    const reason = findBlockedPatternReason(script, policy.gitPatterns ?? [])
    if (reason !== null) return { reason }
  }
  return null
}

// Quoted text is blanked so a message mentioning `--force` passes, but a `$(...)` or backtick
// substitution inside double quotes still runs. Best effort: one level, no deeper quoting analysis.
function quotedSubstitutionScripts(command: string): string[] {
  return quotedSubstitutions(command).flatMap(commandsToInspectForGitPolicy)
}

function quotedSubstitutions(command: string): string[] {
  return commandsToInspectPreservingQuotes(command).flatMap(extractShellCommandSubstitutions)
}

// Config-key rules need `git -c` intact, so these scripts skip global-option stripping.
function rawScripts(command: string): string[] {
  const scripts = commandsToInspectPreservingQuotes(command, { keepGitGlobalOptions: true })
  return [...scripts, ...scripts.flatMap(extractShellCommandSubstitutions)]
}
