import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'
import { BLACKBOARD_ENV, fakeBlackboard } from './fake-blackboard.test-helpers.mts'
import { harness, jsonOf, useRepoFixture } from './harness.test-helpers.mts'
import { agentLabel, deriveAgent } from './pr-agent.mts'
import { PR_ARGS, device } from './pr-tools.test-helpers.mts'
import { runMcpServer } from './run.mts'

describe('deriveAgent', () => {
  it('reads the harness from the launch environment', () => {
    expect(deriveAgent({ CODEX_THREAD_ID: 't' })).toBe('codex')
    expect(deriveAgent({ CLAUDECODE: '1' })).toBe('claude')
    expect(deriveAgent({ CLAUDE_CODE_SESSION_ID: 's' })).toBe('claude')
    expect(deriveAgent({ CURSOR_AGENT: '1' })).toBe('cursor')
    expect(deriveAgent({ GROK_HOOK_EVENT: 'x' })).toBe('grok')
    expect(deriveAgent({ CODEX_THREAD_ID: 't', CLAUDECODE: '1' })).toBe('codex')
  })

  it('falls back to the MCP client name, environment first', () => {
    expect(deriveAgent({}, 'Claude-Code')).toBe('claude')
    expect(deriveAgent({ CURSOR_AGENT: '1' }, 'claude-code')).toBe('cursor')
    expect(deriveAgent({}, 'something-else')).toBeUndefined()
    expect(deriveAgent({})).toBeUndefined()
  })
})

describe('agentLabel', () => {
  it('shows the derived agent alone when the claim names it', () => {
    expect(agentLabel('claude', undefined, undefined)).toBe('claude')
    expect(agentLabel('claude', 'Claude Code', undefined)).toBe('claude')
  })

  it('never lets a mismatched claim replace the derived agent', () => {
    expect(agentLabel('claude', 'codex', 'opus')).toBe(
      'claude (caller-claimed agent: codex; caller-claimed model: opus)',
    )
  })

  it('says unknown when nothing is derivable', () => {
    expect(agentLabel(undefined, undefined, undefined)).toBe('unknown')
    expect(agentLabel(undefined, 'codex', undefined)).toBe('unknown (caller-claimed agent: codex)')
  })
})

describe('pr_validate Agent line', () => {
  const fixture = useRepoFixture()
  const call = async (options: Parameters<typeof harness>[1], extra = {}) => {
    const h = harness(fixture(), { device, ...options })
    const result = jsonOf(
      await h.call('pr_validate', { ...PR_ARGS, worktree: fixture().linked, ...extra }),
    )
    return String(result.body)
  }

  it('renders the derived agent over a spoofed claim', async () => {
    const body = await call({ env: { PATH: '/bin', CLAUDECODE: '1' } }, { agent: 'codex' })
    expect(body).toContain('Agent: claude (caller-claimed agent: codex) session native:owner')
  })

  it('derives the agent from the client name and accepts a missing agent argument', async () => {
    const body = await call({ clientName: () => 'codex-mcp-client' }, { agent: undefined })
    expect(body).toContain('Agent: codex session native:owner')
  })

  it('derives the agent from the initialize clientInfo over the protocol', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await runMcpServer({
      cwd: fixture().main,
      env: BLACKBOARD_ENV,
      version: '1',
      transport: serverTransport,
      blackboard: fakeBlackboard().dependencies,
    })
    const client = new Client({ name: 'codex-mcp-client', version: '1.0.0' })
    await client.connect(clientTransport)
    const result = await client.callTool({
      name: 'pr_validate',
      arguments: { ...PR_ARGS, agent: 'claude', worktree: fixture().linked },
    })
    await client.close()
    const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? ''
    expect(text).toContain('Agent: codex (caller-claimed agent: claude) session native:owner')
  })
})
