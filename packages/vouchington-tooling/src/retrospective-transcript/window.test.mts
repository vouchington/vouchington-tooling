import { describe, expect, it } from 'vitest'
import { computeTranscriptFacts, formatTranscriptFacts } from './index.mts'
import { isTimestamp, optionsWindow, windowRecords } from './window.mts'

const OLD = '2026-01-01T00:00:00.000Z'
const MID = '2026-01-02T00:00:00.000Z'
const NEW = '2026-01-03T00:00:00.000Z'

const claudeUser = (timestamp: string, uuid: string): string =>
  JSON.stringify({ type: 'user', uuid, timestamp, message: { content: 'prompt' } })
const claudeAssistant = (timestamp: string, uuid: string, command: string): string =>
  JSON.stringify({
    type: 'assistant',
    uuid,
    timestamp,
    message: {
      usage: { input_tokens: 10, output_tokens: 5 },
      content: [{ type: 'tool_use', id: uuid, name: 'Bash', input: { command } }],
    },
  })
const claudeLines = [
  claudeUser(OLD, 'u1'),
  claudeAssistant(OLD, 'a1', 'git push'),
  claudeUser(NEW, 'u2'),
  claudeAssistant(NEW, 'a2', 'no-mistakes run'),
]

const codexCall = (timestamp: string, callId: string, command: string): string =>
  JSON.stringify({
    timestamp,
    type: 'response_item',
    payload: {
      type: 'function_call',
      call_id: callId,
      name: 'shell',
      arguments: JSON.stringify({ command }),
    },
  })
const codexTokens = (timestamp: string, input: number): string =>
  JSON.stringify({
    timestamp,
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: { total_token_usage: { input_tokens: input, output_tokens: input / 10 } },
    },
  })
const codexUser = (timestamp: string): string =>
  JSON.stringify({
    timestamp,
    type: 'event_msg',
    payload: { type: 'user_message', message: 'prompt' },
  })
const codexLines = [
  codexUser(OLD),
  codexCall(OLD, 'c1', 'git push origin a'),
  codexTokens(OLD, 100),
  codexUser(NEW),
  codexCall(NEW, 'c2', 'no-mistakes run'),
  codexTokens(NEW, 250),
]

describe('transcript window', () => {
  it('counts only later Claude events and reports how many were excluded', () => {
    const facts = computeTranscriptFacts(claudeLines, [], { since: MID })
    expect(facts).toMatchObject({
      userPrompts: 1,
      assistantResponses: 1,
      toolCalls: 1,
      pushCommandAttempts: 0,
      noMistakesInvocations: 1,
      tokens: { input: 10, output: 5 },
      excludedEvents: 2,
    })
  })

  it('counts only later Codex events, continuing token totals from the excluded ones', () => {
    const facts = computeTranscriptFacts(codexLines, [], { since: MID })
    expect(facts).toMatchObject({
      userPrompts: 1,
      toolCalls: 1,
      pushCommandAttempts: 0,
      noMistakesInvocations: 1,
      tokens: { input: 150, output: 15 },
      excludedEvents: 3,
    })
  })

  it('applies an upper bound as inclusive and excludes later events', () => {
    expect(computeTranscriptFacts(claudeLines, [], { until: MID })).toMatchObject({
      userPrompts: 1,
      pushCommandAttempts: 1,
      noMistakesInvocations: 0,
      excludedEvents: 2,
    })
    expect(computeTranscriptFacts(codexLines, [], { since: OLD, until: NEW })).toMatchObject({
      toolCalls: 1,
      excludedEvents: 3,
    })
  })

  it('windows Claude subagents and Codex subagent segments too', () => {
    const child = [claudeUser(OLD, 'c1'), claudeAssistant(NEW, 'c2', 'git push')]
    expect(computeTranscriptFacts(claudeLines, [child], { since: MID })).toMatchObject({
      pushCommandAttempts: 1,
      excludedEvents: 3,
    })
    const segment = {
      lines: codexLines,
      baseline: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    }
    expect(computeTranscriptFacts(codexLines, [segment], { since: MID })).toMatchObject({
      subagentToolCalls: 1,
      excludedEvents: 6,
    })
  })

  it('reproduces the unwindowed totals exactly when no window is given', () => {
    for (const lines of [claudeLines, codexLines]) {
      const plain = computeTranscriptFacts(lines)
      expect(plain).not.toHaveProperty('excludedEvents')
      expect(computeTranscriptFacts(lines, [], { since: '1999-01-01T00:00:00Z' })).toEqual({
        ...plain,
        excludedEvents: 0,
      })
    }
  })

  it('never excludes records without a usable timestamp or for an unparseable bound', () => {
    const records = [{ type: 'user' }, { type: 'user', timestamp: 'nope' }]
    expect(windowRecords(records, { since: MID })).toMatchObject({ excluded: 0 })
    expect(windowRecords([{ timestamp: OLD }], { since: 'nope', until: 'nope' }).excluded).toBe(0)
  })

  it('builds the window from options only when a bound is present', () => {
    expect(optionsWindow({})).toBeUndefined()
    expect(optionsWindow({ boundary: 'r1' })).toBeUndefined()
    expect(optionsWindow({ since: MID, until: NEW, boundary: 'r1' })).toEqual({
      since: MID,
      until: NEW,
      boundary: 'r1',
    })
    expect(optionsWindow({ until: NEW })).toEqual({ until: NEW })
  })

  it('reports zero excluded events when the facts carry no count', () => {
    expect(formatTranscriptFacts('s', computeTranscriptFacts([]), { since: MID })).toContain(
      `Window: after ${MID}\nExcluded: 0 events outside the window\n`,
    )
  })

  it('accepts only ISO timestamps', () => {
    expect(isTimestamp(MID)).toBe(true)
    for (const value of ['yesterday', '2026-13-45T00:00:00Z', 5, undefined])
      expect(isTimestamp(value)).toBe(false)
  })
})
