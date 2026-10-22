import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { scanCodexFile } from './codex-scan.mts'
import { jsonl, limits, tempDir, writeLines } from './fixtures.test-helpers.mts'
import type { ClassifyFailure } from './types.mts'

const claim: ClassifyFailure = (command) => `kind:${command}`

const completed = (command: string) => ({
  type: 'event_msg',
  payload: { type: 'item_completed', item: { type: 'CommandExecution', command } },
})
const taskStarted = (startedAt: number) => ({
  type: 'event_msg',
  payload: { type: 'task_started', started_at: startedAt },
})
const forkMeta = (extra: Record<string, unknown> = {}) => ({
  type: 'session_meta',
  payload: { timestamp: '2026-01-01T00:00:10.000Z', forked_from_id: 'parent', ...extra },
})

const SESSION_SECONDS = Date.parse('2026-01-01T00:00:10.000Z') / 1000

async function scan(lines: string[], overrides = {}) {
  const dir = tempDir()
  const file = writeLines(join(dir, 'rollout.jsonl'), lines)
  const temp = join(dir, 'tmp')
  writeLines(join(temp, 'keep'), [])
  const result = await scanCodexFile(file, temp, {
    classifyFailure: claim,
    limits: limits(overrides),
  })
  return { result, spoolLeft: readdirSync(temp).filter((name) => name !== 'keep') }
}

const commands = (result: Awaited<ReturnType<typeof scan>>['result']) =>
  'error' in result ? result.error : result.sandboxFailures.map((record) => record.command)

describe('scanCodexFile', () => {
  it('scans a plain session in full', async () => {
    const { result, spoolLeft } = await scan(
      jsonl(
        { type: 'session_meta', payload: { id: 'a', session_id: 'a' } },
        completed('one'),
        completed('two'),
      ),
    )
    expect(commands(result)).toEqual(['one', 'two'])
    expect(spoolLeft).toEqual([])
  })

  it('scans a file with no session metadata, and one with malformed metadata', async () => {
    expect(commands((await scan(jsonl(completed('one')))).result)).toEqual(['one'])
    expect(commands((await scan(['{bad', ...jsonl(completed('two'))])).result)).toEqual(['two'])
  })

  it('treats a fork without a usable timestamp as a plain session', async () => {
    const meta = { type: 'session_meta', payload: { forked_from_id: 'p', timestamp: 'nope' } }
    expect(commands((await scan(jsonl(meta, completed('one')))).result)).toEqual(['one'])
    const noStamp = { type: 'session_meta', payload: { parent_thread_id: 'p' } }
    expect(commands((await scan(jsonl(noStamp, completed('two')))).result)).toEqual(['two'])
  })

  it('drops history inherited from the parent before the first owned task', async () => {
    const { result, spoolLeft } = await scan(
      jsonl(
        forkMeta(),
        completed('inherited'),
        taskStarted(SESSION_SECONDS - 100),
        taskStarted(SESSION_SECONDS * 1000 + 5000),
        completed('owned'),
      ),
    )
    expect(commands(result)).toEqual(['owned'])
    expect(spoolLeft).toEqual([])
  })

  it('recognizes each inherited-session marker', async () => {
    const markers = [
      { source: { subagent: {} } },
      { parent_thread_id: 'p' },
      { id: 'a', session_id: 'b' },
    ]
    for (const marker of markers) {
      const meta = {
        type: 'session_meta',
        payload: { timestamp: '2026-01-01T00:00:10Z', ...marker },
      }
      const { result } = await scan(
        jsonl(meta, completed('inherited'), taskStarted(SESSION_SECONDS), completed('owned')),
      )
      expect(commands(result)).toEqual(['owned'])
    }
  })

  it('ignores task_started records that are malformed or not owned', async () => {
    const { result } = await scan([
      ...jsonl(forkMeta()),
      '{bad',
      ...jsonl(
        { type: 'event_msg', payload: { type: 'task_started' } },
        { type: 'response_item', payload: { type: 'task_started', started_at: SESSION_SECONDS } },
        completed('inherited'),
      ),
    ])
    expect(commands(result)).toEqual(['inherited'])
  })

  it('replays the whole spool, over-counting, when no owned task ever starts', async () => {
    const { result, spoolLeft } = await scan(jsonl(forkMeta(), completed('a'), completed('b')))
    expect(commands(result)).toEqual(['a', 'b'])
    expect(spoolLeft).toEqual([])
  })

  it('fails with a message when the inherited spool passes its limit, and cleans up', async () => {
    const { result, spoolLeft } = await scan(jsonl(forkMeta(), completed('a')), {
      maxInheritedCodexSpoolBytes: 120,
    })
    expect(commands(result)).toBe('inherited Codex spool exceeds 120 byte limit')
    expect(spoolLeft).toEqual([])
  })

  it('waits for drain when the spool stream applies backpressure', async () => {
    const lines = [
      ...jsonl(forkMeta()),
      ...Array.from({ length: 40 }, () => JSON.stringify({ pad: 'x'.repeat(40_000) })),
    ]
    const { result, spoolLeft } = await scan(lines)
    expect(commands(result)).toEqual([])
    expect(spoolLeft).toEqual([])
  })

  it('reports an error for a missing file and an unusable temp root', async () => {
    const dir = tempDir()
    const options = { classifyFailure: claim, limits: limits() }
    expect(await scanCodexFile(join(dir, 'missing.jsonl'), dir, options)).toHaveProperty('error')
    const file = writeLines(join(dir, 'fork.jsonl'), jsonl(forkMeta(), completed('a')))
    writeFileSync(join(dir, 'not-a-dir'), '')
    const result = await scanCodexFile(file, join(dir, 'not-a-dir'), options)
    expect(result).toHaveProperty('error')
  })

  it('reports an error for an oversized record', async () => {
    const dir = tempDir()
    const file = writeLines(join(dir, 'big.jsonl'), [
      JSON.stringify({ pad: 'x'.repeat(2.1 * 1024 * 1024) }),
    ])
    const result = await scanCodexFile(file, dir, { classifyFailure: claim, limits: limits() })
    expect(result).toEqual({ error: 'transcript record exceeds 2097152 byte limit' })
  })
})
