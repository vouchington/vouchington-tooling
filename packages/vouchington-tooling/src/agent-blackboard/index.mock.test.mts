import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const client = vi.hoisted(() => ({
  ensure: vi.fn(),
  list: vi.fn(),
  append: vi.fn(),
  entries: [] as unknown[],
}))

vi.mock('agent-blackboard', () => ({
  Sessions: class {
    ensure = client.ensure
    list = client.list
  },
  Entries: class {
    append = client.append
    async *get(): AsyncGenerator<unknown> {
      yield* client.entries
    }
  },
}))

import { appendJournal, formatJournalEntries, probeBlackboard, readJournal } from './index.mts'
import type { BlackboardClientModule } from './index.mts'

const env = { AGENT_BLACKBOARD_URL: 'https://blackboard.test', AGENT_BLACKBOARD_TOKEN: 'secret' }
const sessionId = 'session:one'
let directory: string | undefined

afterEach(async () => {
  client.ensure.mockReset()
  client.list.mockReset()
  client.append.mockReset()
  client.entries = []
  if (directory) await rm(directory, { recursive: true, force: true })
  directory = undefined
})

async function note(content = 'A durable finding'): Promise<string> {
  directory = await mkdtemp(join(tmpdir(), 'blackboard-index-'))
  const path = join(directory, 'note.md')
  await writeFile(path, content)
  return path
}

describe('agent blackboard client', () => {
  it('probes the configured connection', async () => {
    await probeBlackboard(env)
    expect(client.list).toHaveBeenCalledWith({ limit: 1 })
  })

  it('ensures a session and appends a journal entry', async () => {
    client.ensure.mockResolvedValue({ status: 'created' })
    client.append.mockResolvedValue({ createdAt: '2026-01-01T00:00:00.000Z' })
    await expect(
      appendJournal({
        sessionId,
        agent: 'codex',
        version: '1',
        parentSessionId: 'parent:one',
        timestamp: '2026-01-01T00:00:00.000Z',
        markdownFile: await note(),
        env,
      }),
    ).resolves.toContain('entry created at 2026-01-01T00:00:00.000Z')
    expect(client.ensure).toHaveBeenCalledWith({
      id: sessionId,
      parentSessionId: 'parent:one',
      agent: 'codex',
      version: '1',
    })
    expect(client.append).toHaveBeenCalledWith({
      sessionId,
      data: {
        type: 'journal',
        markdown: 'A durable finding',
        timestamp: '2026-01-01T00:00:00.000Z',
      },
    })
  })

  it('uses null parents and rejects empty notes and invalid identities before client operations', async () => {
    await expect(
      appendJournal({
        sessionId: 'bad/path',
        agent: 'codex',
        version: '1',
        markdownFile: 'missing',
        env,
      }),
    ).rejects.toThrow('URL-safe')
    await expect(
      appendJournal({
        sessionId,
        parentSessionId: 'parent/one',
        agent: 'codex',
        version: '1',
        markdownFile: 'missing',
        env,
      }),
    ).rejects.toThrow('parent session id')
    await expect(
      appendJournal({
        sessionId,
        parentSessionId: '',
        agent: 'codex',
        version: '1',
        markdownFile: 'missing',
        env,
      }),
    ).rejects.toThrow('parent session id')
    expect(client.ensure).not.toHaveBeenCalled()
    await expect(
      appendJournal({ sessionId, agent: 'codex', version: '1', markdownFile: await note(''), env }),
    ).rejects.toThrow('note file is empty')
    client.ensure.mockResolvedValue({ status: 'exists' })
    client.append.mockResolvedValue({ createdAt: timestamp })
    await appendJournal({
      sessionId,
      agent: 'codex',
      version: '1',
      markdownFile: await note(),
      env,
    })
    expect(client.ensure).toHaveBeenLastCalledWith(
      expect.objectContaining({ parentSessionId: null }),
    )
  })

  it('validates timestamps before provider calls and canonicalizes offsets', async () => {
    await expect(
      appendJournal({
        sessionId,
        agent: 'codex',
        version: '1',
        markdownFile: 'missing',
        timestamp: '',
        env,
      }),
    ).rejects.toThrow('valid date-time')
    expect(client.ensure).not.toHaveBeenCalled()
    client.ensure.mockResolvedValue({ status: 'created' })
    client.append.mockResolvedValue({ createdAt: timestamp })
    await appendJournal({
      sessionId,
      agent: 'codex',
      version: '1',
      markdownFile: await note(),
      timestamp: '2026-01-01T01:00:00+01:00',
      env,
    })
    expect(client.append).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ timestamp }) }),
    )
  })

  it('reads and formats only sorted journal entries', async () => {
    client.entries = [
      { createdAt: '2026-01-02T00:00:00.000Z', data: { type: 'journal', markdown: 'later' } },
      { createdAt: '2026-01-01T00:00:00.000Z', data: { type: 'journal', markdown: 'first' } },
      { createdAt: '2026-01-01T00:00:00.000Z', data: { type: 'other', markdown: 'ignore' } },
      null,
    ]
    const entries = await readJournal(sessionId, env)
    expect(entries).toHaveLength(4)
    expect(formatJournalEntries(sessionId, entries)).toBe(
      '## 2026-01-01T00:00:00.000Z\n\nfirst\n\n## 2026-01-02T00:00:00.000Z\n\nlater',
    )
    expect(formatJournalEntries(sessionId, [{}])).toBe(
      `No journal entries found for session ${sessionId}.`,
    )
  })

  it('accepts a typed client loader for all high-level operations', async () => {
    const list = vi.fn()
    const ensure = vi.fn().mockResolvedValue({ status: 'created' })
    const append = vi.fn().mockResolvedValue({ createdAt: timestamp })
    const loader = async (): Promise<BlackboardClientModule> => ({
      Sessions: class {
        list = list
        ensure = ensure
        async get(): Promise<unknown> {
          return {}
        }
      },
      Entries: class {
        append = append
        async *get(): AsyncGenerator<unknown> {
          yield { entry: true }
        }
      },
    })
    await probeBlackboard(env, { loadClient: loader })
    await appendJournal({
      sessionId,
      agent: 'codex',
      version: '1',
      markdownFile: await note(),
      env,
      dependencies: { loadClient: loader },
    })
    await expect(readJournal(sessionId, env, { loadClient: loader })).resolves.toEqual([
      { entry: true },
    ])
    expect(list).toHaveBeenCalledWith({ limit: 1 })
    expect(ensure).toHaveBeenCalledOnce()
    expect(append).toHaveBeenCalledOnce()
  })

  it('normalizes an injected missing optional package error', async () => {
    const loadClient = async (): Promise<BlackboardClientModule> => {
      throw Object.assign(new Error('not installed'), { code: 'ERR_MODULE_NOT_FOUND' })
    }
    await expect(probeBlackboard(env, { loadClient })).rejects.toThrow(
      'optional agent-blackboard package',
    )
  })

  it('preserves unexpected injected loader errors', async () => {
    await expect(
      probeBlackboard(env, {
        loadClient: async () => {
          throw new Error('loader failed')
        },
      }),
    ).rejects.toThrow('loader failed')
  })
})

const timestamp = '2026-01-01T00:00:00.000Z'
