import { isRecord } from '../payload.mts'
import type { HookPayload } from '../types.mts'
import type { HookHarness } from './types.mts'

/**
 * Parses hook stdin into a payload. Blank, invalid, or non-object input is an empty payload, so a
 * malformed call yields no opinion rather than a crash.
 */
export function parseHookPayload(stdin: string): HookPayload {
  if (stdin.trim() === '') return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(stdin)
  } catch {
    return {}
  }
  return isRecord(parsed) && !Array.isArray(parsed) ? normalizeCursorShellPayload(parsed) : {}
}

// Cursor runs the Claude-compat hooks but names its shell tool `Shell` and reports the result as
// `tool_output`, a JSON string `{exitCode, output}`. Normalizing both to Claude's `Bash` +
// `tool_response` shape means policy reads one payload dialect. An existing `tool_response` is
// never overwritten.
export function normalizeCursorShellPayload(payload: HookPayload): HookPayload {
  if (payload.tool_name !== 'Shell') return payload
  const result = cursorShellResult(payload.tool_output)
  return {
    ...payload,
    tool_name: 'Bash',
    ...(result === undefined || payload.tool_response !== undefined
      ? {}
      : { tool_response: result }),
  }
}

function cursorShellResult(raw: unknown): { exit_code: number; stdout: string } | undefined {
  let parsed = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return undefined
    }
  }
  if (!isRecord(parsed) || typeof parsed.exitCode !== 'number') return undefined
  return {
    exit_code: parsed.exitCode,
    stdout: typeof parsed.output === 'string' ? parsed.output : '',
  }
}

// GROK_AGENT is deliberately not a signal: it is a shell-level marker that could be exported in a
// Claude or Codex session.
function isGrokHookProcess(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.GROK_SESSION_ID || env.GROK_HOOK_EVENT)
}

// Cursor passes `cursor_version` in every payload and sets CURSOR_VERSION/CURSOR_PROJECT_DIR in the
// hook env. It runs the Claude-compat config, so the markers only override `claude`, never `codex`.
function isCursorHookProcess(
  declared: HookHarness,
  env: NodeJS.ProcessEnv,
  payload: HookPayload,
): boolean {
  return (
    declared === 'claude' &&
    (typeof payload.cursor_version === 'string' ||
      Boolean(env.CURSOR_VERSION || env.CURSOR_PROJECT_DIR))
  )
}

/**
 * The harness actually calling. Grok and Cursor reuse another harness's hook configuration, so
 * their own env and payload markers win over the declared `--harness`. Cursor resolves before
 * `claude` is trusted because it inherits Claude's attended env when launched from a Claude session.
 */
export function resolveHarness(
  declared: HookHarness,
  env: NodeJS.ProcessEnv,
  payload: HookPayload,
): HookHarness {
  if (isGrokHookProcess(env)) return 'grok'
  if (isCursorHookProcess(declared, env, payload)) return 'cursor'
  return declared
}

/** True when the process is running inside CI automation, where merge authority is never delegated. */
export function isAutomationContext(env: NodeJS.ProcessEnv): boolean {
  return env.GITHUB_ACTIONS === 'true' || env.CI === 'true'
}

/**
 * True only when Claude Code marks the session attended (CLAUDE_CODE_SESSION_ATTENDED=1; 0 for
 * `claude -p`). A missing or changed variable fails safe: no silent merge allow.
 */
export function isAttendedClaudeSession(env: NodeJS.ProcessEnv): boolean {
  return env.CLAUDE_CODE_SESSION_ATTENDED === '1'
}
