import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const client = vi.hoisted(() => ({
  ensure: vi.fn(),
  patch: vi.fn(),
  list: vi.fn(),
  append: vi.fn(),
  entries: [] as unknown[],
}))

vi.mock('agent-blackboard', () => ({
  Sessions: class {
    ensure = client.ensure
    patch = client.patch
    list = client.list
  },
  Entries: class {
    append = client.append
    async *get(): AsyncGenerator<unknown> {
      yield* client.entries
    }
  },
}))

import { formatJournalEntries, probeBlackboard, readJournal } from './index.mts'
import type { BlackboardClientModule } from './index.mts'

const env = { AGENT_BLACKBOARD_URL: 'https://blackboard.test', AGENT_BLACKBOARD_TOKEN: 'secret' }
const sessionId = 'session:one'
const originalCwd = process.cwd()
let directory: string | undefined

afterEach(async () => {
  client.ensure.mockReset()
  client.patch.mockReset()
  client.list.mockReset()
  client.append.mockReset()
  client.entries = []
  process.chdir(originalCwd)
  if (directory) await rm(directory, { recursive: true, force: true })
  directory = undefined
})

describe('agent blackboard client', () => {
  it('probes the configured connection', async () => {
    await probeBlackboard(env)
    expect(client.list).toHaveBeenCalledWith({ limit: 1 })
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
    const ensure = vi.fn().mockResolvedValue({ status: 'created', session: { data: {} } })
    const patch = vi.fn()
    const append = vi.fn().mockResolvedValue({ createdAt: timestamp })
    const loader = async (): Promise<BlackboardClientModule> => ({
      Sessions: class {
        list = list
        ensure = ensure
        patch = patch
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
    await expect(readJournal(sessionId, env, { loadClient: loader })).resolves.toEqual([
      { entry: true },
    ])
    expect(list).toHaveBeenCalledWith({ limit: 1 })
  })

  it.each(['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'])(
    'normalizes an injected %s integration dependency error',
    async (code) => {
      const loadClient = async (): Promise<BlackboardClientModule> => {
        throw Object.assign(new Error('not installed'), { code })
      }
      await expect(probeBlackboard(env, { loadClient })).rejects.toThrow(
        'install it alongside vouchington-tooling',
      )
    },
  )

  it('loads the integration from the consumer package context', async () => {
    directory = await mkdtemp(join(tmpdir(), 'blackboard-consumer-'))
    const packageDirectory = join(directory, 'node_modules', 'agent-blackboard')
    await mkdir(packageDirectory, { recursive: true })
    await writeFile(
      join(packageDirectory, 'package.json'),
      JSON.stringify({ name: 'agent-blackboard', type: 'module', exports: './index.mjs' }),
    )
    await writeFile(
      join(packageDirectory, 'index.mjs'),
      'export class Sessions { async list() { return [] } }\nexport class Entries {}\n',
    )
    process.chdir(directory)

    await expect(probeBlackboard(env)).resolves.toBeUndefined()
  })

  it('loads the integration from an explicit caller package context', async () => {
    directory = await mkdtemp(join(tmpdir(), 'blackboard-caller-'))
    const packageDirectory = join(directory, 'node_modules', 'agent-blackboard')
    await mkdir(packageDirectory, { recursive: true })
    await writeFile(
      join(packageDirectory, 'package.json'),
      JSON.stringify({ name: 'agent-blackboard', type: 'module', exports: './index.mjs' }),
    )
    await writeFile(
      join(packageDirectory, 'index.mjs'),
      'export class Sessions { async list() { return [] } }\nexport class Entries {}\n',
    )

    await expect(
      probeBlackboard(env, { resolveFrom: join(directory, 'script.mjs') }),
    ).resolves.toBeUndefined()
  })

  it('preserves invalid consumer package errors', async () => {
    directory = await mkdtemp(join(tmpdir(), 'blackboard-invalid-consumer-'))
    const packageDirectory = join(directory, 'node_modules', 'agent-blackboard')
    await mkdir(packageDirectory, { recursive: true })
    await writeFile(join(packageDirectory, 'package.json'), '{')
    process.chdir(directory)

    await expect(
      probeBlackboard(env, { resolveFrom: join(directory, 'script.mjs') }),
    ).rejects.toMatchObject({
      code: 'ERR_INVALID_PACKAGE_CONFIG',
    })
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
