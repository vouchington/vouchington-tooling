export type HookPayload = Record<string, unknown>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Tool name across Claude-compatible (`tool_name`), camelCase and bare (`name`) payloads. */
export function hookToolName(payload: HookPayload): string {
  for (const key of ['tool_name', 'toolName', 'name']) {
    const value = payload[key]
    if (typeof value === 'string') return value
  }
  return ''
}

/** The shell command a tool call ran, or '' when the payload carries none. */
export function extractToolCommand(payload: HookPayload): string {
  for (const key of ['tool_input', 'toolInput', 'input']) {
    const input = payload[key]
    if (isRecord(input) && typeof input.command === 'string') return input.command
  }
  return typeof payload.command === 'string' ? payload.command : ''
}

/** A numeric `exit_code` from the response shapes that carry one; undefined otherwise. */
export function toolExitCode(payload: HookPayload): number | undefined {
  for (const key of ['tool_response', 'toolResponse', 'toolResult']) {
    const response = payload[key]
    if (isRecord(response) && typeof response.exit_code === 'number') return response.exit_code
  }
  return undefined
}

export function parseHookPayload(raw: string): HookPayload {
  try {
    const parsed: unknown = JSON.parse(raw)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}
