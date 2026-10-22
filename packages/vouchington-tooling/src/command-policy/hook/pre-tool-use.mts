import { evaluateCommandPolicy } from '../engine.mts'
import type { CommandPolicy, HookPayload } from '../types.mts'
import type { HookHarness } from './types.mts'

/**
 * What a pre-tool-use hook writes and exits with. Exit 2 is the block all four harnesses honor.
 * Claude, Codex, and Grok surface the stderr reason; Cursor surfaces the stdout JSON. Exit 0 with
 * empty stdio is no opinion.
 */
export type PreToolUseResult = { exitCode: 0 | 2; stderr: string; stdout: string }

export type PreToolUseOptions = {
  harness?: HookHarness | undefined
  /** True only when the harness marked the session attended (see isAttendedClaudeSession). */
  attended?: boolean | undefined
  /** See EvaluateOptions.automationContext. */
  automationContext?: boolean | undefined
  cwd?: string | undefined
}

export function preToolUseOutput(
  payload: HookPayload,
  policy: CommandPolicy | undefined,
  options: PreToolUseOptions = {},
): PreToolUseResult {
  // A policy module without a command table has no opinion, merge authority included.
  if (policy === undefined) {
    return { exitCode: 0, stderr: '', stdout: noOpinion(options) }
  }
  const decision = evaluateCommandPolicy(payload, policy, {
    ...(options.automationContext === undefined
      ? {}
      : { automationContext: options.automationContext }),
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
  })
  if (decision === null) {
    return { exitCode: 0, stderr: '', stdout: noOpinion(options) }
  }
  if (decision.disposition === 'confirm') {
    return { exitCode: 0, stderr: '', stdout: renderConfirm(policy, options) }
  }
  return {
    exitCode: 2,
    stderr: `${decision.reason}\n`,
    stdout: JSON.stringify({ decision: 'deny', reason: decision.reason }),
  }
}

// Cursor treats a hook that prints nothing as failed (and blocks the call under `failClosed`), so
// "no opinion" there is an empty JSON object. Every other harness reads empty stdio as no opinion.
function noOpinion(options: PreToolUseOptions): string {
  return options.harness === 'cursor' ? '{}' : ''
}

// Only an attended Claude session gets a silent allow: the human already made the merge decision by
// asking for it, so a second tool-level click is redundant. Codex, Cursor, Grok, and an unattended
// Claude session (`claude -p`) get no opinion, so the harness's own prompt or classifier decides.
function renderConfirm(policy: CommandPolicy, options: PreToolUseOptions): string {
  if (options.harness !== 'claude' || options.attended !== true) {
    return noOpinion(options)
  }
  const guidance = policy.mergeGuidance === undefined ? '' : ` ${policy.mergeGuidance}`
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: `Interactive merge: proceeding on the human decision already made in this session.${guidance}`,
    },
  })
}
