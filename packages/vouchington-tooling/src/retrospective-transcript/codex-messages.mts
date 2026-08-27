import { asRecord, type ParsedLine } from './shared.mts'

export function codexMessageCounts(records: ParsedLine[]): [number, number] {
  let currentUser = 0
  let currentAssistant = 0
  let legacyUser = 0
  let legacyAssistant = 0
  for (const record of records) {
    const payload = asRecord(record.payload)
    if (record.type === 'response_item' && payload?.type === 'message') {
      if (payload.role === 'user') currentUser++
      if (payload.role === 'assistant') currentAssistant++
    }
    if (record.type === 'event_msg' && payload?.type === 'user_message') legacyUser++
    if (record.type === 'event_msg' && payload?.type === 'agent_message') legacyAssistant++
  }
  return [currentUser || legacyUser, currentAssistant || legacyAssistant]
}
