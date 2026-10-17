import { describe, expect, it, vi } from 'vitest'

import { BlackboardNotInstalledError } from './client.mts'
import {
  payloadSessionId,
  probeAdvisory,
  sessionStartContext,
  sessionStartOutput,
} from './session-start.mts'

describe('payloadSessionId', () => {
  it('prefers session_id, then sessionId, then conversation_id', () => {
    expect(payloadSessionId({ session_id: 'a', sessionId: 'b', conversation_id: 'c' })).toBe('a')
    expect(payloadSessionId({ sessionId: ' b ', conversation_id: 'c' })).toBe('b')
    expect(payloadSessionId({ conversation_id: 'c' })).toBe('c')
  })

  it('skips non-strings, empty, unsafe, and oversized ids', () => {
    expect(payloadSessionId({ session_id: 7, sessionId: '  ', conversation_id: 'a b' })).toBe(
      undefined,
    )
    expect(payloadSessionId({ session_id: 'x'.repeat(257), sessionId: 'ok' })).toBe('ok')
    expect(payloadSessionId({})).toBeUndefined()
  })
})

describe('probeAdvisory', () => {
  const healthy = vi.fn(async () => {})

  it('skips the probe for compact restarts, the skip variable, and the sandbox', async () => {
    const probe = vi.fn(async () => {})
    expect(await probeAdvisory({ payload: { source: 'compact' }, env: {}, probe })).toBeUndefined()
    expect(await probeAdvisory({ payload: {}, env: { CHECK_BLACKBOARD_SKIP: '1' }, probe })).toBe(
      undefined,
    )
    expect(
      await probeAdvisory({ payload: {}, env: { MY_SKIP: '1' }, skipEnv: 'MY_SKIP', probe }),
    ).toBeUndefined()
    expect(await probeAdvisory({ payload: {}, env: { SANDBOX_RUNTIME: '1' }, probe })).toContain(
      'NOT an outage',
    )
    expect(probe).not.toHaveBeenCalled()
  })

  it('stays silent when the probe succeeds and forwards the environment', async () => {
    const env = { AGENT_BLACKBOARD_URL: 'u' }
    expect(await probeAdvisory({ payload: {}, env, probe: healthy })).toBeUndefined()
    expect(healthy).toHaveBeenCalledWith(env, undefined)
  })

  it('reports an outage with the docs path', async () => {
    const probe = vi.fn(async () => {
      throw new Error('503')
    })
    const text = await probeAdvisory({ payload: {}, env: {}, probe, docsPath: 'docs/bb.md' })
    expect(text).toContain('availability assessment failed (sessions list probe failed: 503)')
    expect(text).toContain('(see docs/bb.md)')
    expect(text).toContain('durable outbox')
  })

  it('reports a non-Error failure without docs', async () => {
    const probe = vi.fn(async () => {
      throw 'boom'
    })
    const text = await probeAdvisory({ payload: {}, env: {}, probe })
    expect(text).toContain('probe failed: boom')
    expect(text).not.toContain('(see ')
  })

  it('reports a missing client as a setup problem with the repository hint', async () => {
    const probe = vi.fn(async () => {
      throw new BlackboardNotInstalledError('agent-blackboard is not installed')
    })
    const text = await probeAdvisory({
      payload: {},
      env: {},
      probe,
      setupHint: 'Run pnpm install.',
    })
    expect(text).toContain('workspace-setup problem')
    expect(text).toContain('Run pnpm install.')
    expect(await probeAdvisory({ payload: {}, env: {}, probe })).not.toContain('  ')
  })

  it('uses the installed client by default', async () => {
    const list = vi.fn(async () => ({}))
    const Sessions = vi.fn(function () {
      return { list }
    })
    const dependencies = {
      loadClient: async () => ({ Sessions, Entries: vi.fn() }) as never,
    }
    const env = { AGENT_BLACKBOARD_URL: 'https://x', AGENT_BLACKBOARD_TOKEN: 't' }
    expect(await probeAdvisory({ payload: {}, env, dependencies })).toBeUndefined()
    expect(list).toHaveBeenCalledWith({ limit: 1 })
    expect(await probeAdvisory({ payload: {}, env: {}, dependencies })).toContain(
      'AGENT_BLACKBOARD_URL is not set',
    )
  })

  it('reads process.env when no environment is given', async () => {
    const probe = vi.fn(async () => {})
    vi.stubEnv('CHECK_BLACKBOARD_SKIP', '1')
    expect(await probeAdvisory({ payload: {}, probe })).toBeUndefined()
    vi.unstubAllEnvs()
  })
})

describe('sessionStartContext', () => {
  const probe = async () => {}

  it('prints the session id line and the advisory', async () => {
    const failing = async () => {
      throw new Error('down')
    }
    const text = await sessionStartContext({
      payload: { session_id: 'abc' },
      env: {},
      probe: failing,
    })
    expect(text?.split('\n')[0]).toBe(
      'Blackboard sessionId: abc (pass it as `sessionId` to every journal tool)',
    )
    expect(text?.split('\n')).toHaveLength(2)
  })

  it('re-prints the session id on compact restarts', async () => {
    expect(
      await sessionStartContext({
        payload: { session_id: 'abc', source: 'compact' },
        env: {},
        probe,
      }),
    ).toContain('abc')
  })

  it('has nothing to say without an id or advisory', async () => {
    expect(await sessionStartContext({ payload: {}, env: {}, probe })).toBeUndefined()
  })
})

describe('sessionStartOutput', () => {
  it('wraps the context in the SessionStart hook envelope', () => {
    expect(JSON.parse(sessionStartOutput('hi'))).toEqual({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'hi' },
    })
  })
})
