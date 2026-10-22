import { commandsToInspectForGitHubPolicy } from './github-command-context.mts'
import { parseGhOrGhStackInvocation } from './github-invocation.mts'
import { hasNumericPrSelector } from './github-option-flags.mts'
import { plainShellAssignment, tokenizeShellWords } from '../shell-parse/index.mts'
import type { BlockDecision } from './types.mts'

// `gh` or `gh-stack` as a word of its own, including a path (`/usr/bin/gh`).
const GH_WORD = /(?:^|[^\w.-])gh(?:-stack)?(?![\w.-])/
const MERGE_WORD = /(?<![\w-])merge(?![\w-])/
const MERGE_ENDPOINT = /\/merges?(?:$|[/?#])|mergePullRequest|enablePullRequestAutoMerge/

function suffix(guidance: string): string {
  return guidance === '' ? '' : ` ${guidance}`
}

/**
 * Automation never receives merge authority. The check is deliberately coarse and parses no
 * wrappers: a command that names gh and has a merge-shaped word in any script the hook reads
 * blocks. Overmatches (a `git merge` beside gh, merge help, quoted prose) are accepted.
 * Interactively this returns null.
 */
export function findAutomationMergeBlock(
  command: string,
  automationContext: boolean,
  guidance = '',
): BlockDecision | null {
  if (!automationContext || !mentionsGhMerge(command)) return null
  return {
    disposition: 'block',
    reason: `Merge authority is never delegated to an agent in automation. This command names gh together with a merge (\`gh pr merge\`, \`gh stack merge\`, or a \`gh api\` merge endpoint or mutation), so it is blocked in automation; a human performs the merge. If the merge text is only prose, split the command or move the prose into a --body-file.${suffix(guidance)}`,
  }
}

function mentionsGhMerge(command: string): boolean {
  // Tokens, not raw text: a shell-composed name like `g"h"` still runs gh.
  return commandsToInspectForGitHubPolicy(command).some((inspected) => {
    const tokens = tokenizeShellWords(inspected, { splitRedirections: true })
    return tokens.some((token) => GH_WORD.test(token)) && tokens.some(isMergeShaped)
  })
}

function isMergeShaped(token: string): boolean {
  return (
    token === 'merge' ||
    MERGE_ENDPOINT.test(token) ||
    (GH_WORD.test(token) && MERGE_WORD.test(token))
  )
}

/**
 * The 'confirm' disposition for an interactive merge, which a caller may render as a silent allow
 * in an attended session. Call it last, so any block anywhere in the command wins; only a command
 * that is one plain merge qualifies.
 */
export function findInteractiveMergeConfirm(
  command: string,
  automationContext: boolean,
  guidance = '',
): BlockDecision | null {
  if (automationContext || !isLoneMergeCommand(command)) {
    return null
  }
  return {
    disposition: 'confirm',
    reason: `Merging is a human decision - confirm you want this exact merge before it proceeds.${suffix(guidance)}`,
  }
}

// Anything that can join, redirect, substitute, expand, glob, escape, or comment shell text.
const SHELL_METACHARACTERS = /[;&|<>()`$\\\n\r{}*?[\]#!]/

/**
 * True only for a command that is exactly one `gh pr merge`, or one `gh stack merge` with a
 * numeric selector, optionally after plain `NAME=value` assignments or `env NAME=value`. The
 * raw-text check rejects every compound, wrapped, or expanded form before tokenizing, so a lone
 * merge can never carry a second command along with the allow.
 */
export function isLoneMergeCommand(command: string): boolean {
  if (SHELL_METACHARACTERS.test(command)) {
    return false
  }
  const tokens = tokenizeShellWords(command)
  let index = skipAssignments(tokens, 0)
  if (tokens[index] === 'env') {
    index = skipAssignments(tokens, index + 1)
  }
  const executable = tokens[index]?.split('/').at(-1)
  if (executable !== 'gh' && executable !== 'gh-stack') {
    return false
  }
  const invocation = parseGhOrGhStackInvocation(tokens, index)
  if (invocation?.action !== 'merge') {
    return false
  }
  return (
    invocation.area === 'pr' ||
    (invocation.area === 'stack' && hasNumericPrSelector(invocation.optionTokens))
  )
}

function skipAssignments(tokens: string[], start: number): number {
  let index = start
  while (index < tokens.length && plainShellAssignment(tokens[index]!) !== null) {
    index += 1
  }
  return index
}
