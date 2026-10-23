import { hookFilePath, hookToolInput } from '../payload.mts'
import { patchResultPaths } from '../path-references.mts'
import type { HookContext, HookPolicy, PostToolUseWarning } from './types.mts'

function failure(error: unknown): PostToolUseWarning {
  const message = error instanceof Error ? error.message : String(error)
  return { level: 'error', message: `Unexpected error in post-tool-use checks: ${message}` }
}

/** Runs every matching checker. A checker that throws becomes one error warning, never a crash. */
export function checkFile(
  filePath: string,
  root: string,
  checkers: HookPolicy['checkers'] = [],
): PostToolUseWarning[] {
  return checkers.flatMap((checker) => {
    try {
      return checker.matches(filePath, root) ? checker.check(filePath, root) : []
    } catch (error) {
      return [failure(error)]
    }
  })
}

// Edit/Write report `file_path`; Codex's apply_patch carries every touched file in its patch headers,
// and only files that exist afterwards are checked.
function editedPaths(context: HookContext): string[] {
  const command = hookToolInput(context.payload)?.command
  if (typeof command === 'string' && command.startsWith('*** Begin Patch')) {
    return patchResultPaths(command)
  }
  const filePath = hookFilePath(context.payload)
  return filePath === '' ? [] : [filePath]
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
  // Grok ignores stdout for passive events and documents no other channel, so stay silent.
  if (context.harness === 'grok') return ''
  const warnings = editedPaths(context).flatMap((path) =>
    checkFile(path, context.root, policy.checkers),
  )
  const lines = warnings.map(({ level, message }) => `[${level}] ${message}`)
  const reminder = await reminderOf(policy, context)
  const text = [...lines, ...(reminder === null ? [] : [reminder])].join('\n')
  if (text === '') return ''
  return `${JSON.stringify({
    hookSpecificOutput: { additionalContext: text, hookEventName: 'PostToolUse' },
  })}\n`
}
