import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { buildSessionFrictionReport, readFrictionLog, recordFriction } from './index.mts'
const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'friction-fixed-ledger-'))
  directories.push(directory)
  const options = { directory, maxEvents: 1 }
  const observation = { type: 'permission-request' as const, command: 'git push' }
  recordFriction('owner', observation, options)
  const path = join(
    directory,
    (await readdir(directory)).find((name) => name.endsWith('.jsonl'))!,
  )
  return { options, observation, path }
}
it('keeps rejected capture storage bounded and preserves counted drops when the cap increases', async () => {
  const { options, observation, path } = await fixture()
  const before = await readFile(path)
  for (let index = 0; index < 10; index++) recordFriction('owner', observation, options)
  expect(await readFile(path)).toEqual(before)
  expect((await stat(`${path}.coverage`)).size).toBeLessThanOrEqual(192)
  expect(readFrictionLog('owner', options)).toMatchObject({
    status: 'events',
    truncated: true,
    droppedCount: 10,
  })
  recordFriction('owner', observation, { ...options, maxEvents: 2 })
  expect(readFrictionLog('owner', { ...options, maxEvents: 2 })).toMatchObject({
    events: [expect.any(Object), expect.any(Object)],
    droppedCount: 10,
  })
  recordFriction('owner', observation, { ...options, maxEvents: 2 })
  expect(readFrictionLog('owner', { ...options, maxEvents: 2 })).toMatchObject({
    droppedCount: 11,
  })
})
it('adds counted new drops to retained historical malformed and overflow markers', async () => {
  const { options, observation, path } = await fixture()
  await writeFile(path, (await readFile(path, 'utf8')) + '{"type":"coverage-drop"}\nmalformed\n')
  recordFriction('owner', observation, options)
  expect(readFrictionLog('owner', options)).toMatchObject({ droppedCount: 3, truncated: true })
})
it('reports interrupted, hostile and mismatched ledger state as unavailable instead of complete', async () => {
  for (const corruption of ['pending', 'invalid', 'oversized', 'symlink', 'mismatched']) {
    const { options, observation, path } = await fixture()
    recordFriction('owner', observation, options)
    const sidecar = `${path}.coverage`
    if (corruption === 'pending') await writeFile(`${sidecar}.pending`, 'partial update')
    else if (corruption === 'invalid') await writeFile(sidecar, '{"droppedCount":0}')
    else if (corruption === 'oversized') await writeFile(sidecar, 'x'.repeat(193))
    else if (corruption === 'symlink') {
      await rm(sidecar)
      await symlink(path, sidecar)
    } else await writeFile(path, (await readFile(path, 'utf8')) + '\n')
    expect(() => readFrictionLog('owner', options)).toThrow()
    const report = await buildSessionFrictionReport('owner', {
      ...options,
      journalLoader: () => ({ status: 'not-found' }),
    })
    expect(report.coverage).toMatchObject({ frictionStatus: 'unreadable', truncated: true })
    expect(report.markdown).toContain('Status: unavailable (friction log unreadable)')
  }
})
it('fails visibly before numeric overflow can reset or understate dropped evidence', async () => {
  const { options, observation, path } = await fixture()
  recordFriction('owner', observation, options)
  const sidecar = `${path}.coverage`
  const ledger = JSON.parse(await readFile(sidecar, 'utf8'))
  await writeFile(sidecar, JSON.stringify({ ...ledger, droppedCount: Number.MAX_SAFE_INTEGER }))
  expect(() => recordFriction('owner', observation, options)).toThrow(/overflow.*incomplete/)
  expect(readFrictionLog('owner', options)).toMatchObject({ droppedCount: Number.MAX_SAFE_INTEGER })
  await writeFile(path, (await readFile(path, 'utf8')) + 'malformed\n')
  await writeFile(
    sidecar,
    JSON.stringify({
      ...ledger,
      logBytes: (await stat(path)).size,
      droppedCount: Number.MAX_SAFE_INTEGER,
    }),
  )
  expect(() => readFrictionLog('owner', options)).toThrow(/overflow.*incomplete/)
})
it('resynchronizes bounded metadata after an external log append without losing previously counted drops', async () => {
  const { options, observation, path } = await fixture()
  recordFriction('owner', observation, options)
  await writeFile(path, (await readFile(path, 'utf8')) + 'malformed\n')
  recordFriction('owner', observation, options)
  expect(readFrictionLog('owner', options)).toMatchObject({ droppedCount: 3 })
})

it('rejects untrusted cached fields before using the fast path', async () => {
  const { options, observation, path } = await fixture()
  recordFriction('owner', observation, options)
  const sidecar = `${path}.coverage`
  const valid = JSON.parse(await readFile(sidecar, 'utf8'))
  const cases = [
    null,
    1,
    { ...valid, schemaVersion: 2 },
    ...['retainedEvents', 'logBytes', 'droppedCount'].flatMap((field) =>
      [null, '1', 1.5, -1].map((value) => ({ ...valid, [field]: value })),
    ),
    { ...valid, retainedEvents: 501 },
    { ...valid, logBytes: 2_000_001 },
    { ...valid, droppedCount: 0 },
  ]
  for (const value of cases) {
    await writeFile(sidecar, JSON.stringify(value))
    expect(() => recordFriction('owner', observation, options)).toThrow(/invalid.*ledger/)
    expect(() => readFrictionLog('owner', options)).toThrow(/invalid.*ledger/)
  }
})
it('counts malformed combined failure evidence instead of trusting it', async () => {
  const { options, path } = await fixture()
  const event = JSON.parse((await readFile(path, 'utf8')).trim())
  const failures = [
    null,
    1,
    {},
    { kind: 'unknown', detail: 'bad' },
    { kind: 'sandbox-failure', detail: '' },
    { kind: 'sandbox-failure', detail: 'unsafe\u0000' },
    { kind: 'sandbox-failure', detail: 'bad', extra: true },
  ]
  await writeFile(path, failures.map((failure) => JSON.stringify({ ...event, failure })).join('\n'))
  expect(readFrictionLog('owner', options)).toEqual({
    status: 'empty',
    truncated: true,
    droppedCount: failures.length,
  })
})
it('counts byte-cap rejection before the event cap without losing retained valid evidence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'friction-byte-cap-'))
  directories.push(directory)
  const options = { directory, timestamp: '界'.repeat(1000) }
  const observation = {
    type: 'tool-result' as const,
    command: 'node test',
    permissionOutcome: 'approved' as const,
    escalationDetail: '界'.repeat(1000),
  }
  recordFriction('owner', observation, options)
  const path = join(
    directory,
    (await readdir(directory)).find((name) => name.endsWith('.jsonl'))!,
  )
  const event = await readFile(path, 'utf8')
  const retained = Math.floor(2_000_000 / Buffer.byteLength(event))
  expect(retained).toBeLessThan(500)
  const content = event.repeat(retained)
  await writeFile(path, content)
  recordFriction('owner', observation, options)
  expect(await readFile(path, 'utf8')).toBe(content)
  const result = readFrictionLog('owner', options)
  expect(result).toMatchObject({ status: 'events', truncated: true, droppedCount: 1 })
  if (result.status === 'events') expect(result.events).toHaveLength(retained)
  recordFriction('owner', observation, options)
  expect(readFrictionLog('owner', options)).toMatchObject({ droppedCount: 2 })
  const report = await buildSessionFrictionReport('owner', {
    ...options,
    journalLoader: () => ({ status: 'not-found' }),
  })
  expect(report.coverage).toMatchObject({ truncated: true, droppedCount: 2 })
  expect(report.markdown).toContain('Status: partial')
})
