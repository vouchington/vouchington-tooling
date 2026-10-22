import { normalizeCommandPrefix, redactOverlongToken } from './command-prefix.mts'
import { asRecord } from './shared.mts'

export type SandboxEscalation = {
  commandPrefix: string
  justification?: string
  prefixRule?: string[]
}

const MAX_JUSTIFICATION_LENGTH = 240

// Only a parsed `exec_command` function_call whose JSON arguments request
// `sandbox_permissions: "require_escalated"` counts. Text that merely quotes the field
// (for example an auto-review prompt) never reaches here because it is not a call.
// The approval outcome is not recorded in a stable shape, so it is intentionally omitted.
export function escalationOf(payload: Record<string, unknown>): SandboxEscalation | undefined {
  if (payload.type !== 'function_call' || payload.name !== 'exec_command') return undefined
  if (typeof payload.arguments !== 'string') return undefined
  let args: Record<string, unknown> | undefined
  try {
    args = asRecord(JSON.parse(payload.arguments))
  } catch {
    return undefined
  }
  if (args?.sandbox_permissions !== 'require_escalated') return undefined
  const command = args.cmd ?? args.command
  const justification =
    typeof args.justification === 'string'
      ? args.justification.replace(/\s+/g, ' ').trim().slice(0, MAX_JUSTIFICATION_LENGTH)
      : ''
  const rule = Array.isArray(args.prefix_rule)
    ? args.prefix_rule.filter((token): token is string => typeof token === 'string')
    : []
  return {
    commandPrefix: typeof command === 'string' ? normalizeCommandPrefix(command) : '',
    ...(justification ? { justification } : {}),
    ...(rule.length ? { prefixRule: rule.map(redactOverlongToken) } : {}),
  }
}
