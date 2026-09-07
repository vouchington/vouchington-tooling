import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { HARNESS_IDS, inspectHarnessEnvironment, selectHarnessSession } from './index.mts'
import { HARNESS_IDS as configHarnessIds } from '../agent-harness-config/index.mts'

describe('agent harness identity', () => {
  it('inspects every simultaneous harness signal without choosing one', () => {
    expect(
      inspectHarnessEnvironment({
        CLAUDECODE: '1',
        CLAUDE_CODE_SESSION_ID: 'claude-session',
        CODEX_THREAD_ID: 'codex-session',
        CURSOR_AGENT: '1',
        CURSOR_SESSION_ID: 'cursor-session',
        GROK_AGENT: '1',
        GROK_HOOK_EVENT: '1',
        GROK_SESSION_ID: 'grok-session',
      }),
    ).toEqual({
      claude: { compatMode: true, sessionId: 'claude-session' },
      codex: { sessionId: 'codex-session' },
      cursor: { agentMarker: true, sessionId: 'cursor-session' },
      grok: { agentMarker: true, hookEvent: true, sessionId: 'grok-session' },
    })
  })

  it('keeps markers while ignoring empty session values', () => {
    expect(
      inspectHarnessEnvironment({
        CLAUDE_CODE_SESSION_ID: '',
        CODEX_THREAD_ID: '',
        CURSOR_AGENT: 'present',
        CURSOR_SESSION_ID: '',
        GROK_AGENT: 'present',
        GROK_HOOK_EVENT: 'present',
        GROK_SESSION_ID: '',
      }),
    ).toEqual({
      claude: { compatMode: false },
      codex: {},
      cursor: { agentMarker: true },
      grok: { agentMarker: true, hookEvent: true },
    })
  })

  it('uses only the caller supplied precedence and never infers a default', () => {
    const environment = inspectHarnessEnvironment({
      CODEX_THREAD_ID: 'codex-session',
      CURSOR_SESSION_ID: 'cursor-session',
      GROK_SESSION_ID: 'grok-session',
    })

    expect(selectHarnessSession(environment, ['grok', 'codex', 'cursor'])).toEqual({
      harness: 'grok',
      sessionId: 'grok-session',
    })
    expect(selectHarnessSession(environment, ['cursor', 'codex'])).toEqual({
      harness: 'cursor',
      sessionId: 'cursor-session',
    })
    expect(selectHarnessSession(environment, ['claude'])).toBeUndefined()
  })

  it('keeps the config harness identifier export compatible', () => {
    expect(configHarnessIds).toBe(HARNESS_IDS)
  })

  it('publishes the root and dedicated subpath contracts', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { exports: Record<string, unknown> }

    expect(manifest.exports['./agent-harness-identity']).toEqual({
      default: './dist/agent-harness-identity/index.mjs',
      import: './dist/agent-harness-identity/index.mjs',
      types: './dist/agent-harness-identity/index.d.mts',
    })
    expect(HARNESS_IDS).toEqual(['claude', 'codex', 'grok', 'cursor'])
  })
})
