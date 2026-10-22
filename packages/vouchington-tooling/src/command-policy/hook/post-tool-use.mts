import { hookFilePath } from '../payload.mts'
import type { HookContext, HookPolicy, PostToolUseWarning } from './types.mts'

/** Runs every matching checker. A checker that throws becomes one error warning, never a crash. */
export function checkFile(
  filePath: string,
  root: string,
  checkers: HookPolicy['checkers'] = [],
): PostToolUseWarning[] {
  try {
    return checkers.flatMap((checker) =>
      checker.matches(filePath, root) ? checker.check(filePath, root) : [],
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return [{ level: 'error', message: `Unexpected error in post-tool-use checks: ${message}` }]
  }
}

async function reminderOf(policy: HookPolicy, context: HookContext): Promise<string | null> {
  try {
    return (await policy.reminder?.(context)) || null
  } catch {
    return null
  }
}

/**
 * The stdout of a post-tool-use hook: one `additionalContext` JSON object carrying the checkers'
 * `[level] message` lines and the reminder, or an empty string when there is nothing to say. The
 * hook is advisory and never blocks, so failures here are swallowed.
 */
export async function postToolUseOutput(context: HookContext, policy: HookPolicy): Promise<string> {
  const filePath = hookFilePath(context.payload)
  const warnings = filePath === '' ? [] : checkFile(filePath, context.root, policy.checkers)
  const lines = warnings.map(({ level, message }) => `[${level}] ${message}`)
  const reminder = await reminderOf(policy, context)
  const text = [...lines, ...(reminder === null ? [] : [reminder])].join('\n')
  if (text === '') return ''
  return `${JSON.stringify({
    hookSpecificOutput: { additionalContext: text, hookEventName: 'PostToolUse' },
  })}\n`
}
