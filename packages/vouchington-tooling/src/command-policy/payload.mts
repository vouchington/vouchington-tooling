import type { HookPayload } from './types.mts'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function hookToolInput(payload: HookPayload): Record<string, unknown> | undefined {
  if (isRecord(payload.tool_input)) return payload.tool_input
  if (isRecord(payload.toolInput)) return payload.toolInput
  return undefined
}

export function extractToolCommand(payload: HookPayload): string {
  const toolInput = hookToolInput(payload)
  if (toolInput && typeof toolInput.command === 'string') return toolInput.command
  if (typeof payload.command === 'string') return payload.command
  return ''
}

function firstString(values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return ''
}

export function hookToolName(payload: HookPayload): string {
  return firstString([payload.tool_name, payload.toolName])
}

export function hookSessionId(payload: HookPayload): string {
  return firstString([payload.session_id, payload.sessionId, payload.conversation_id])
}

export function hookFilePath(payload: HookPayload): string {
  if (typeof payload.file_path === 'string' && payload.file_path !== '') return payload.file_path
  if (typeof payload.filePath === 'string' && payload.filePath !== '') return payload.filePath
  const toolInput = hookToolInput(payload)
  if (!toolInput) return ''
  for (const key of ['file_path', 'filePath', 'path'] as const) {
    const value = toolInput[key]
    if (typeof value === 'string' && value !== '') return value
  }
  return ''
}

export function hookCwd(payload: HookPayload, fallback: string = process.cwd()): string {
  const toolInput = hookToolInput(payload)
  for (const value of [toolInput?.cwd, toolInput?.workdir, payload.cwd, payload.workspaceRoot]) {
    if (typeof value === 'string') return value
  }
  return fallback
}
