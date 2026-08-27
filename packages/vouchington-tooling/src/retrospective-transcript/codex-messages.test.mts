import { describe, expect, it } from 'vitest'
import { computeTranscriptFacts } from './index.mts'

const current = (role: string): string =>
  JSON.stringify({ type: 'response_item', payload: { type: 'message', role, content: [] } })
const legacy = (type: string): string => JSON.stringify({ type: 'event_msg', payload: { type } })

describe('Codex message pairing', () => {
  it('counts unstructured and mixed-content user messages', () => {
    const facts = computeTranscriptFacts([
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user' } }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [
            { type: 'image' },
            { type: 'input_text', text: 'ordinary block' },
            { type: 'input_text', text: '<environment_context>injected</environment_context>' },
          ],
        },
      }),
    ])

    expect(facts.userPrompts).toBe(2)
  })

  it('keeps inverse schema orders as distinct messages', () => {
    const facts = computeTranscriptFacts([
      legacy('user_message'),
      current('user'),
      current('assistant'),
      legacy('agent_message'),
    ])

    expect(facts).toMatchObject({ userPrompts: 2, assistantResponses: 2 })
  })

  it('requires duplicate representations to be adjacent', () => {
    const facts = computeTranscriptFacts([
      current('user'),
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'function_call', call_id: 'call', name: 'other' },
      }),
      legacy('user_message'),
      legacy('agent_message'),
      JSON.stringify({ type: 'event_msg', payload: { type: 'token_count' } }),
      current('assistant'),
    ])

    expect(facts).toMatchObject({ userPrompts: 2, assistantResponses: 2, toolCalls: 1 })
  })

  it('keeps ignored injected records transparent to duplicate pairs', () => {
    const injected = JSON.stringify({
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: '<skill>\n<name>x</name>\n<path>/x</path>\nrules\n</skill>',
          },
        ],
      },
    })
    const user = computeTranscriptFacts([current('user'), injected, legacy('user_message')])
    const assistant = computeTranscriptFacts([
      legacy('agent_message'),
      injected,
      current('assistant'),
    ])

    expect(user.userPrompts).toBe(1)
    expect(assistant).toMatchObject({ userPrompts: 0, assistantResponses: 1 })
  })
})
