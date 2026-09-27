import { mkdtemp, rm, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import {
  buildSessionFrictionReport,
  classifyFrictionObservation,
  readFrictionLog,
  recordFriction,
} from './index.mts'
it('records dropped capture counts and renders partial coverage without a clean claim', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'friction-coverage-'))
  try {
    const options = { directory, maxEvents: 1 }
    recordFriction('owner', { type: 'permission-request', command: 'git push' }, options)
    recordFriction('owner', { type: 'permission-request', command: 'git push' }, options)
    const log = readFrictionLog('owner', options)
    expect(log).toMatchObject({
      status: 'events',
      truncated: true,
      droppedCount: 1,
      events: [{ outcome: 'requested' }],
    })
    const report = await buildSessionFrictionReport('owner', {
      ...options,
      journalLoader: () => ({ status: 'not-found' }),
    })
    expect(report.coverage).toEqual({
      journalStatus: 'complete',
      frictionStatus: 'events',
      truncated: true,
      droppedCount: 1,
    })
    expect(report.markdown).toContain('Status: partial')
    expect(report.markdown).toContain('Dropped records: 1')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
it('keeps requested permissions distinct from actual decisions and localhost causes ambiguous', () => {
  expect(
    classifyFrictionObservation({ type: 'permission-request', command: 'git push' }),
  ).toMatchObject({ outcome: 'requested' })
  expect(
    classifyFrictionObservation({
      type: 'tool-result',
      command: 'git push',
      permissionOutcome: 'denied',
    }),
  ).toMatchObject({ outcome: 'denied' })
  expect(
    classifyFrictionObservation({
      type: 'tool-result',
      command: 'git push',
      permissionOutcome: 'approved',
    }),
  ).toMatchObject({ outcome: 'approved' })
  expect(
    classifyFrictionObservation({
      type: 'tool-result',
      command: 'node test',
      structuredStderr: 'ECONNREFUSED localhost:5432',
    }),
  ).toMatchObject({ kind: 'ambiguous-failure' })
})

it('preserves historical drop markers in a full event log while recording new drops in bounded state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'friction-full-coverage-'))
  try {
    const options = { directory, maxEvents: 1 }
    recordFriction('owner', { type: 'permission-request', command: 'git push' }, options)
    const path = join(directory, (await readdir(directory))[0]!)
    const event = await readFile(path, 'utf8')
    const marker = '{"type":"coverage-drop"}\n'
    const count = Math.floor((2_000_000 - Buffer.byteLength(event)) / Buffer.byteLength(marker))
    const prefix = event + marker.repeat(count)
    await writeFile(path, prefix + ' '.repeat(2_000_000 - Buffer.byteLength(prefix)))
    recordFriction('owner', { type: 'permission-request', command: 'git push' }, options)
    expect(readFrictionLog('owner', options)).toMatchObject({
      truncated: true,
      droppedCount: count + 1,
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
it('rejects invalid permission result outcomes instead of treating them as actual decisions', () => {
  expect(
    classifyFrictionObservation({
      type: 'tool-result',
      command: 'git push',
      permissionOutcome: 'invented' as 'approved',
    }),
  ).toBeNull()
})
it('reports dropped-only capture as unavailable rather than observed clean', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'friction-dropped-only-'))
  try {
    recordFriction('owner', { type: 'tool-result', command: 'echo clean' }, { directory })
    const path = join(directory, (await readdir(directory))[0]!)
    await writeFile(path, '{"type":"coverage-drop"}\n')
    const report = await buildSessionFrictionReport('owner', {
      directory,
      journalLoader: () => ({ status: 'not-found' }),
    })
    expect(report.coverage).toMatchObject({
      frictionStatus: 'empty',
      truncated: true,
      droppedCount: 1,
    })
    expect(report.markdown).toContain('Status: unavailable (partial capture; dropped 1 records)')
    expect(report.markdown).not.toContain('## Sandbox & Permission Audit\nStatus: none observed')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('retains approved permission and failure facts from the same result in the stored audit', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'friction-combined-'))
  try {
    for (const structuredStderr of ['EPERM', 'ECONNREFUSED localhost:5432']) {
      recordFriction(
        'owner',
        {
          type: 'tool-result',
          command: 'node test',
          permissionOutcome: 'approved',
          structuredStderr,
        },
        { directory },
      )
    }
    const log = readFrictionLog('owner', { directory })
    expect(log).toMatchObject({
      status: 'events',
      events: [
        {
          kind: 'sandbox-escalation',
          outcome: 'approved',
          failure: { kind: 'sandbox-failure', detail: 'stderr matched "EPERM"' },
        },
        { kind: 'sandbox-escalation', outcome: 'approved', failure: { kind: 'ambiguous-failure' } },
      ],
    })
    const report = await buildSessionFrictionReport('owner', {
      directory,
      journalLoader: () => ({ status: 'not-found' }),
    })
    expect(report.markdown).toContain('sandbox-escalation (2)')
    expect(report.markdown).toContain('sandbox-failure (1)')
    expect(report.markdown).toContain('ambiguous-failure (1)')
    expect(report.markdown.match(/outcome: approved/g)).toHaveLength(2)
    expect(report.markdown).toContain('Events observed: 4')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('retains escalation and a simultaneous failure', () => {
  expect(
    classifyFrictionObservation({
      type: 'tool-result',
      command: 'rtk git push',
      commandWrappers: ['rtk'],
      escalationDetail: 'sandbox override',
      structuredStderr: 'EPERM',
    }),
  ).toEqual({
    kind: 'sandbox-escalation',
    commandPrefix: 'rtk git push',
    detail: 'sandbox override',
    outcome: 'unknown',
    failure: { kind: 'sandbox-failure', detail: 'stderr matched "EPERM"' },
  })
})

it('makes malformed tagged journal records visibly partial', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'friction-malformed-journal-'))
  try {
    recordFriction('owner', { type: 'tool-result', command: 'echo clean' }, { directory })
    for (const markdown of [undefined, null, 42, {}, []]) {
      const report = await buildSessionFrictionReport('owner', {
        directory,
        journalLoader: () => ({ status: 'ok', entries: [{ data: { type: 'journal', markdown } }] }),
      })
      expect(report.coverage.journalStatus).toBe('partial')
      expect(report.markdown).toContain('Status: unavailable (journal scan incomplete)')
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('marks unreadable journal access partial without rendering its raw exception', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'friction-journal-getter-'))
  try {
    const report = await buildSessionFrictionReport('owner', {
      directory,
      journalLoader: () => ({
        status: 'ok',
        entries: [
          {
            get data(): never {
              throw new Error('private backend exception')
            },
          },
        ],
      }),
    })
    expect(report.coverage.journalStatus).toBe('partial')
    expect(report.markdown).not.toContain('private backend exception')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
