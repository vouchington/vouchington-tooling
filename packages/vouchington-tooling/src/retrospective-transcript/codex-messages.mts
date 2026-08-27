import { asRecord, type ParsedLine } from './shared.mts'

type Role = 'user' | 'assistant'
type Message = { role: Role; schema: 'current' | 'legacy' }

function isInjectedBlock(raw: string): boolean {
  const text = raw.trim()
  const agents =
    text.startsWith('# AGENTS.md instructions for ') &&
    text.includes('\n<INSTRUCTIONS>') &&
    text.endsWith('</INSTRUCTIONS>')
  const environment =
    text.startsWith('<environment_context>') &&
    ['<cwd>', '<shell>', '<current_date>', '<timezone>', '<filesystem>'].every((tag) =>
      text.includes(tag),
    ) &&
    text.endsWith('</environment_context>')
  const skill =
    text.startsWith('<skill>') &&
    text.includes('\n<name>') &&
    text.includes('\n<path>') &&
    text.endsWith('</skill>')
  return agents || environment || skill
}

function isInjectedUser(payload: ParsedLine): boolean {
  if (!Array.isArray(payload.content) || payload.content.length === 0) return false
  return payload.content.map(asRecord).every((item) => {
    return (
      item?.type === 'input_text' && typeof item.text === 'string' && isInjectedBlock(item.text)
    )
  })
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
  // Hosted rollouts emit user duplicates current→legacy and assistant duplicates legacy→current.
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
    if (!current) {
      this.previous = undefined
      return
    }
    if (injected) return
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
