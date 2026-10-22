import { describe, expect, it } from 'vitest'
import { computeTranscriptFacts, formatTranscriptFacts, normalizeCommandPrefix } from './index.mts'

const call = (args: unknown, name = 'exec_command', type = 'function_call'): string =>
  JSON.stringify({
    type: 'response_item',
    payload: {
      type,
      name,
      call_id: `c${Math.random()}`,
      arguments: typeof args === 'string' ? args : JSON.stringify(args),
    },
  })
const escalated = { sandbox_permissions: 'require_escalated' }

describe('Codex sandbox escalations', () => {
  it('reports only the escalated exec_command', () => {
    const cmd = 'cd /repo && GIT_EDITOR=true git -C /repo switch -c fix'
    const facts = computeTranscriptFacts([
      call({ cmd: 'ls -la' }),
      call({
        cmd,
        ...escalated,
        justification: 'Allow writing\nGit metadata   please',
        prefix_rule: ['git', 'switch', 'x'.repeat(41)],
      }),
    ])
    expect(facts.toolCalls).toBe(2)
    expect(facts.escalations).toEqual([
      {
        commandPrefix: normalizeCommandPrefix(cmd),
        justification: 'Allow writing Git metadata please',
        prefixRule: ['git', 'switch', '…'],
      },
    ])
    expect(facts.escalations[0]?.commandPrefix).toBe('git switch')
  })

  it('ignores text that only mentions require_escalated', () => {
    const text = 'use "sandbox_permissions": "require_escalated" when needed'
    const facts = computeTranscriptFacts([
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
      }),
      call({ cmd: 'echo hi', note: text }),
      call(escalated, 'other_tool'),
      call(escalated, 'exec_command', 'custom_tool_call'),
      call('not json require_escalated'),
      call('[1]'),
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'function_call', name: 'exec_command', arguments: { ...escalated } },
      }),
    ])
    expect(facts.escalations).toEqual([])
    expect(formatTranscriptFacts('s', facts)).not.toContain('escalations')
  })

  it('tolerates missing command, justification, and prefix rule', () => {
    const facts = computeTranscriptFacts([
      call({ ...escalated, command: 'pnpm run build', prefix_rule: 'git', justification: 3 }),
      call({ ...escalated, prefix_rule: [1, 2], justification: '  ' }),
    ])
    expect(facts.escalations).toEqual([{ commandPrefix: 'pnpm run build' }, { commandPrefix: '' }])
  })

  it('formats the escalations', () => {
    const facts = computeTranscriptFacts([
      call({
        cmd: 'git push',
        ...escalated,
        justification: 'Publish',
        prefix_rule: ['git', 'push'],
      }),
      call({ ...escalated }),
    ])
    const text = formatTranscriptFacts('s', facts)
    expect(text).toContain('Sandbox escalations: 2')
    expect(text).toContain('- git push prefix_rule=["git","push"] justification="Publish"')
    expect(text).toContain('- (unknown)\n')
  })
})
