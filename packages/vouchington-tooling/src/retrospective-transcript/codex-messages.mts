import { asRecord, type ParsedLine } from './shared.mts'

type Role = 'user' | 'assistant'
type Message = { role: Role; schema: 'current' | 'legacy' }

function isInjectedBlock(raw: string): boolean {
  const text = raw.trim()
  // Hosted metadata occupies complete input blocks; inner fields can vary by runtime version.
  const agents =
    /^# AGENTS\.md instructions for [^\r\n]+(?:\r?\n)+<INSTRUCTIONS(?:\s[^>]*)?>[\s\S]*<\/INSTRUCTIONS>$/.test(
      text,
    )
  const environment = /^<environment_context(?:\s[^>]*)?>[\s\S]*<\/environment_context>$/.test(text)
  const skill = /^<skill(?:\s[^>]*)?>[\s\S]*<\/skill>$/.test(text)
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
  // Hosted rollouts currently emit user as current→legacy and assistant as legacy→current;
  // keep directional to avoid merging inverse-order distinct turns (see pairing tests).
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
    // Injected records are transparent because hosted metadata can split a duplicate pair.
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
