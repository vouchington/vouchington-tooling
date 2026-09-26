import { customExecCommands } from './javascript-command.mts'
import { asRecord } from './shared.mts'

export function commands(payload: Record<string, unknown>): string[] {
  const raw = payload.type === 'function_call' ? payload.arguments : payload.input
  if (payload.type === 'local_shell_call') {
    const input = asRecord(raw)
    const value = asRecord(input?.action)?.command ?? input?.command
    if (typeof value === 'string') return [value]
    if (!Array.isArray(value)) return []
    return value.every((item) => typeof item === 'string') ? [value.join(' ')] : []
  }
  const customExec = payload.type === 'custom_tool_call' && payload.name === 'exec'
  if (!customExec && !['exec_command', 'bash', 'shell', 'Bash'].includes(String(payload.name)))
    return []
  if (typeof raw !== 'string') return []
  if (customExec) return customExecCommands(raw)
  try {
    const value = asRecord(JSON.parse(raw))
    const candidate = value?.cmd ?? value?.command
    return typeof candidate === 'string' ? [candidate] : []
  } catch {
    return []
  }
}

export function hasFailedOutcome(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasFailedOutcome)
  const payload = asRecord(value)
  if (!payload) return false
  if (payload.type === 'input_text' && typeof payload.text === 'string') {
    try {
      return hasFailedOutcome(JSON.parse(payload.text))
    } catch {
      return false
    }
  }
  if (payload.status === 'failed' || payload.status === 'error' || payload.is_error === true)
    return true
  if (
    (typeof payload.exit_code === 'number' && payload.exit_code !== 0) ||
    (typeof payload.exitCode === 'number' && payload.exitCode !== 0) ||
    payload.success === false
  )
    return true
  return [payload.output, payload.result, payload.metadata].some(hasFailedOutcome)
}
