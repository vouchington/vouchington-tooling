import { isRecord } from '../payload.mts'
import type { HookPayload } from '../types.mts'
import type { HookHarness } from './types.mts'

/** Environment variables that mark an automated launch. Set to anything but empty, `0`, or `false`. */
const AUTOMATION_MARKERS = [
  'CI',
  'GITHUB_ACTIONS',
  'GITLAB_CI',
  'BUILDKITE',
  'CIRCLECI',
  'JENKINS_URL',
  'TF_BUILD',
  'CODEBUILD_BUILD_ID',
] as const

/**
 * True when the process runs unattended, where merge authority is never delegated: Claude's
 * `claude -p` (`CLAUDE_CODE_SESSION_ATTENDED=0`) or a CI marker. `extraMarkers` adds
 * caller-specific variable names.
 */
export function isAutomationContext(
  env: NodeJS.ProcessEnv,
  extraMarkers: readonly string[] = [],
): boolean {
  if (env.CLAUDE_CODE_SESSION_ATTENDED === '0') return true
  return [...AUTOMATION_MARKERS, ...extraMarkers].some((name) => {
    const value = env[name]?.trim().toLowerCase()
    return value !== undefined && value !== '' && value !== '0' && value !== 'false'
  })
}

/**
 * Parses hook stdin into a payload. Blank, invalid, or non-object input is an empty payload unless
 * `strict`, which throws so a blocking hook fails closed instead of reading a missing or truncated
 * payload as "nothing to judge".
 */
export function parseHookPayload(stdin: string, strict = false): HookPayload {
  if (stdin.trim() === '') {
    if (strict) throw new Error('hook payload is empty')
    return {}
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(stdin)
  } catch (error) {
    if (strict) throw new Error(`hook payload is not valid JSON: ${(error as Error).message}`)
    return {}
  }
  if (isRecord(parsed) && !Array.isArray(parsed)) return normalizeCursorShellPayload(parsed)
  if (strict) throw new Error('hook payload is not a JSON object')
  return {}
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
    stdout: firstString(parsed.stdout, parsed.output),
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

/**
 * True only when Claude Code marks the session attended (CLAUDE_CODE_SESSION_ATTENDED=1; 0 for
 * `claude -p`). A missing or changed variable fails safe: no silent merge allow.
 */
export function isAttendedClaudeSession(env: NodeJS.ProcessEnv): boolean {
  return env.CLAUDE_CODE_SESSION_ATTENDED === '1'
}

// Cursor documents `stdout`; `output` is kept as a fallback for older payloads.
function firstString(...values: unknown[]): string {
  return values.find((value): value is string => typeof value === 'string') ?? ''
}
