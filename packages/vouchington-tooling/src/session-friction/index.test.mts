import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  classifyFrictionObservation,
  FRICTION_LOG_MAX_EVENTS,
  normalizeCommandPrefix,
  readFrictionLog,
  recordFriction,
} from './index.mts'
import type { FrictionLogOptions } from './types.mts'

const directories: string[] = []
async function directory(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'session-friction-'))
  directories.push(value)
  return value
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((value) => rm(value, { force: true, recursive: true })),
  )
})

describe('normalizeCommandPrefix', () => {
  it('normalizes compound commands, runners, assignments, and git options', () => {
    expect(normalizeCommandPrefix('cd /private/path && CI=1 pnpm exec vitest run')).toBe(
      'pnpm exec vitest',
    )
    expect(normalizeCommandPrefix('git -C /private/path push origin main')).toBe('git push')
    expect(normalizeCommandPrefix('git --no-pager status')).toBe('git status')
    expect(normalizeCommandPrefix('git --work-tree=/private/path status')).toBe('git status')
    expect(normalizeCommandPrefix('rtk git status')).toBe('rtk git status')
    expect(normalizeCommandPrefix("echo 'git push' && gh pr view 1")).toBe('echo git push')
    expect(normalizeCommandPrefix('cd /private/path')).toBe('cd /private/path')
  })

  it('redacts overlong tokens in the report-safe prefix', () => {
    expect(normalizeCommandPrefix(`secret=${'x'.repeat(80)}`)).toBe('…')
  })
})

describe('classifyFrictionObservation', () => {
  it('prioritizes escalation over a simultaneous failure', () => {
    expect(
      classifyFrictionObservation({
        type: 'tool-result',
        command: 'git push',
        escalationDetail: 'sandbox override',
        structuredStderr: 'EPERM',
      }),
    ).toEqual({ kind: 'sandbox-escalation', commandPrefix: 'git push', detail: 'sandbox override' })
  })

  it('classifies permission requests and structured stderr only', () => {
    expect(
      classifyFrictionObservation({ type: 'permission-request', command: 'pnpm test' }),
    ).toEqual({
      kind: 'sandbox-escalation',
      commandPrefix: 'pnpm test',
      detail: 'permission-request',
    })
    expect(
      classifyFrictionObservation({
        type: 'tool-result',
        command: 'node test',
        structuredStderr: 'ECONNREFUSED 127.0.0.1',
      }),
    ).toEqual({
      kind: 'sandbox-failure',
      commandPrefix: 'node test',
      detail: 'stderr matched localhost connection failure',
    })
    expect(
      classifyFrictionObservation({
        type: 'tool-result',
        command: 'cat',
        structuredStderr: 'EPERM',
      }),
    ).toEqual({
      kind: 'sandbox-failure',
      commandPrefix: 'cat',
      detail: 'stderr matched "EPERM"',
    })
    expect(classifyFrictionObservation({ type: 'tool-result', command: 'rg EPERM' })).toBeNull()
    expect(
      classifyFrictionObservation({
        type: 'tool-result',
        command: 'echo ok',
        structuredStderr: 'ordinary diagnostic',
      }),
    ).toBeNull()
    expect(classifyFrictionObservation({ type: 'permission-request', command: '   ' })).toBeNull()
    expect(classifyFrictionObservation({ type: 'permission-request', command: '' })).toBeNull()
  })
})

describe('friction log', () => {
  it('touches a log for unclassified observations and reads absent/empty/events distinctly', async () => {
    const directoryPath = await directory()
    const options: FrictionLogOptions = { directory: directoryPath }
    expect(readFrictionLog('session', options)).toEqual({ status: 'absent' })
    recordFriction(
      'session',
      { type: 'tool-result', command: 'echo ok' },
      { ...options, timestamp: 't' },
    )
    expect(readFrictionLog('session', options)).toEqual({ status: 'empty' })
    recordFriction(
      'session',
      { type: 'tool-result', command: 'git push', escalationDetail: 'override' },
      { ...options, timestamp: '2026-01-01T00:00:00.000Z' },
    )
    expect(readFrictionLog('session', options)).toEqual({
      status: 'events',
      events: [
        {
          kind: 'sandbox-escalation',
          timestamp: '2026-01-01T00:00:00.000Z',
          commandPrefix: 'git push',
          detail: 'override',
        },
      ],
    })
  })

  it('requires an absolute directory and applies the event cap', async () => {
    expect(() => readFrictionLog('s', { directory: 'relative' })).toThrow(/absolute/)
    const directoryPath = await directory()
    for (let index = 0; index < FRICTION_LOG_MAX_EVENTS + 2; index++)
      recordFriction(
        'capped',
        { type: 'permission-request', command: 'git push' },
        { directory: directoryPath, timestamp: String(index) },
      )
    const result = readFrictionLog('capped', { directory: directoryPath })
    expect(result.status).toBe('events')
    if (result.status === 'events') expect(result.events).toHaveLength(FRICTION_LOG_MAX_EVENTS)
    expect(isAbsolute(directoryPath)).toBe(true)
    const raw = await readFile(join(directoryPath, 'capped.jsonl'), 'utf8')
    expect(raw.trim().split('\n')).toHaveLength(FRICTION_LOG_MAX_EVENTS)
  })

  it('ignores malformed lines while retaining valid events', async () => {
    const directoryPath = await directory()
    recordFriction(
      'malformed',
      { type: 'permission-request', command: 'git push' },
      { directory: directoryPath, timestamp: 't' },
    )
    const path = join(directoryPath, 'malformed.jsonl')
    const original = await readFile(path, 'utf8')
    await rm(path)
    await writeFile(
      path,
      [
        'not-json',
        'null',
        '1',
        '{}',
        '{"kind":"other","timestamp":"t","commandPrefix":"git push","detail":"x"}',
        '{"kind":"sandbox-failure","timestamp":1,"commandPrefix":"git push","detail":"x"}',
        '{"kind":"sandbox-failure","timestamp":"t","commandPrefix":1,"detail":"x"}',
        '{"kind":"sandbox-failure","timestamp":"t","commandPrefix":"git push","detail":1}',
        original.trim(),
        '',
      ].join('\n'),
    )
    const result = readFrictionLog('malformed', { directory: directoryPath })
    expect(result.status).toBe('events')
  })

  it('sanitizes session ids and validates limits before touching storage', async () => {
    const directoryPath = await directory()
    recordFriction(
      'parent:child/path',
      { type: 'permission-request', command: 'git push' },
      { directory: directoryPath, maxEvents: 1, timestamp: 't' },
    )
    expect(await readFile(join(directoryPath, 'parent_child_path.jsonl'), 'utf8')).toContain(
      'permission-request',
    )
    expect(() =>
      recordFriction(
        'invalid-limit',
        { type: 'permission-request', command: 'git push' },
        { directory: directoryPath, maxEvents: 0 },
      ),
    ).toThrow(/positive integer/)
    await expect(readFile(join(directoryPath, 'invalid-limit.jsonl'), 'utf8')).rejects.toThrow()
  })

  it('supports callback and generated timestamps', async () => {
    const directoryPath = await directory()
    recordFriction(
      'timestamps',
      { type: 'permission-request', command: 'git push' },
      { directory: directoryPath, timestamp: () => 'callback' },
    )
    recordFriction(
      'timestamps',
      { type: 'permission-request', command: 'pnpm test' },
      { directory: directoryPath },
    )
    const result = readFrictionLog('timestamps', { directory: directoryPath })
    expect(result.status).toBe('events')
    if (result.status === 'events') {
      expect(result.events[0]?.timestamp).toBe('callback')
      expect(result.events[1]?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    }
  })
})
