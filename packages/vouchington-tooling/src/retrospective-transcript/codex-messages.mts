import { asRecord, type ParsedLine } from './shared.mts'

type Role = 'user' | 'assistant'
type Message = { role: Role; schema: 'current' | 'legacy' }

function isInjectedUser(payload: ParsedLine): boolean {
  if (!Array.isArray(payload.content)) return false
  const first = payload.content
    .map(asRecord)
    .find((item) => item?.type === 'input_text' && typeof item.text === 'string')
  const text = typeof first?.text === 'string' ? first.text.trimStart() : undefined
  return (
    text?.startsWith('# AGENTS.md instructions for ') === true ||
    text?.startsWith('<environment_context>') === true ||
    text?.startsWith('<skill>') === true
  )
}

function message(record: ParsedLine, payload: ParsedLine | undefined): Message | undefined {
  if (record.type === 'response_item' && payload?.type === 'message') {
    if (payload.role === 'user' || payload.role === 'assistant')
      return { role: payload.role, schema: 'current' }
  } else if (record.type === 'event_msg') {
    if (payload?.type === 'user_message') return { role: 'user', schema: 'legacy' }
    if (payload?.type === 'agent_message') return { role: 'assistant', schema: 'legacy' }
  }
  return undefined
}

function isDuplicate(previous: Message | undefined, current: Message): boolean {
  return (
    (current.role === 'user' && previous?.schema === 'current' && current.schema === 'legacy') ||
    (current.role === 'assistant' && previous?.schema === 'legacy' && current.schema === 'current')
  )
}

export class CodexMessageCounter {
  private previous: Message | undefined
  private userPrompts = 0
  private assistantResponses = 0

  add(record: ParsedLine, payload: ParsedLine | undefined): void {
    const current = message(record, payload)
    const injected =
      current?.schema === 'current' &&
      current.role === 'user' &&
      payload !== undefined &&
      isInjectedUser(payload)
    if (!current || injected) {
      this.previous = undefined
      return
    }
    if (this.previous?.role === current.role && isDuplicate(this.previous, current)) {
      this.previous = undefined
      return
    }
    if (current.role === 'user') this.userPrompts++
    else this.assistantResponses++
    this.previous = current
  }

  totals(): [number, number] {
    return [this.userPrompts, this.assistantResponses]
  }
}
