import { existsSync } from 'node:fs'
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'

import { classifyFrictionObservation, readFrictionLog, recordFriction } from './index.mts'
import type { FrictionObservation } from './types.mts'

const directories: string[] = []

async function temporaryDirectory(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'session-friction-hardening-'))
  directories.push(value)
  return value
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((value) => rm(value, { force: true, recursive: true })),
  )
})

it('rejects a symlinked session log without modifying its target', async () => {
  const directory = await temporaryDirectory()
  const outside = await temporaryDirectory()
  const options = { directory }
  recordFriction('linked-log', { type: 'tool-result', command: 'echo ok' }, options)
  const file = (await readdir(directory)).find((value) => value.endsWith('.jsonl'))!
  const path = join(directory, file)
  const target = join(outside, 'target')
  await writeFile(target, 'unchanged')
  await chmod(target, 0o644)
  await rm(path)
  await symlink(target, path)

  expect(() =>
    recordFriction('linked-log', { type: 'permission-request', command: 'git push' }, options),
  ).toThrow(/regular file/)
  expect(() => readFrictionLog('linked-log', options)).toThrow(/regular file/)
  expect(await readFile(target, 'utf8')).toBe('unchanged')
  expect((await stat(target)).mode & 0o777).toBe(0o644)
})

it('rejects a non-regular session log', async () => {
  const directory = await temporaryDirectory()
  const options = { directory }
  recordFriction('directory-log', { type: 'tool-result', command: 'echo ok' }, options)
  const file = (await readdir(directory)).find((value) => value.endsWith('.jsonl'))!
  const path = join(directory, file)
  await rm(path)
  await mkdir(path)
  expect(() => readFrictionLog('directory-log', options)).toThrow(/regular file/)
  expect(() =>
    recordFriction('directory-log', { type: 'permission-request', command: 'git push' }, options),
  ).toThrow(/regular file/)
})

it('rejects invalid UTF-8 in a session log', async () => {
  const directory = await temporaryDirectory()
  const options = { directory }
  recordFriction('invalid-utf8', { type: 'tool-result', command: 'echo ok' }, options)
  const file = (await readdir(directory)).find((value) => value.endsWith('.jsonl'))!
  await writeFile(join(directory, file), Buffer.from([0x7b, 0x22, 0x80, 0x22, 0x7d]))
  expect(() => readFrictionLog('invalid-utf8', options)).toThrow(/not valid UTF-8/)
})

it('rejects a multiply-linked session log without modifying its target', async () => {
  const directory = await temporaryDirectory()
  const outside = await temporaryDirectory()
  const options = { directory }
  recordFriction('linked-inode', { type: 'tool-result', command: 'echo ok' }, options)
  const file = (await readdir(directory)).find((value) => value.endsWith('.jsonl'))!
  const path = join(directory, file)
  const target = join(outside, 'target')
  await writeFile(target, 'unchanged')
  await rm(path)
  await link(target, path)

  expect(() => readFrictionLog('linked-inode', options)).toThrow(/regular file/)
  expect(() =>
    recordFriction('linked-inode', { type: 'permission-request', command: 'git push' }, options),
  ).toThrow(/regular file/)
  expect(await readFile(target, 'utf8')).toBe('unchanged')
})

it('reclaims an orphaned stale reaper guard', async () => {
  const directory = await temporaryDirectory()
  const options = { directory }
  recordFriction('orphaned-reaper', { type: 'tool-result', command: 'echo ok' }, options)
  const file = (await readdir(directory)).find((value) => value.endsWith('.jsonl'))!
  const reaper = join(directory, `${file}.lock.reap`)
  await writeFile(reaper, '')
  await utimes(reaper, new Date(0), new Date(0))
  expect(readFrictionLog('orphaned-reaper', options)).toEqual({ status: 'empty' })
  expect(existsSync(reaper)).toBe(false)
})

it('reclaims future-dated ownerless locks and reaper guards', async () => {
  const directory = await temporaryDirectory()
  const options = { directory }
  recordFriction('future-lock', { type: 'tool-result', command: 'echo ok' }, options)
  const file = (await readdir(directory)).find((value) => value.endsWith('.jsonl'))!
  const future = new Date(Date.now() + 60_000)
  await writeFile(join(directory, `${file}.lock`), '')
  await utimes(join(directory, `${file}.lock`), future, future)
  recordFriction('future-lock', { type: 'permission-request', command: 'git push' }, options)
  await writeFile(join(directory, `${file}.lock.reap`), '')
  await utimes(join(directory, `${file}.lock.reap`), future, future)
  expect(readFrictionLog('future-lock', options)).toMatchObject({ status: 'events' })
})

it('preserves an expired lock owned by a running process', async () => {
  const directory = await temporaryDirectory()
  const options = { directory }
  recordFriction('reused-owner', { type: 'tool-result', command: 'echo ok' }, options)
  const file = (await readdir(directory)).find((value) => value.endsWith('.jsonl'))!
  const lock = join(directory, `${file}.lock`)
  await writeFile(lock, String(process.pid))
  await utimes(lock, new Date(0), new Date(0))
  expect(() =>
    recordFriction('reused-owner', { type: 'permission-request', command: 'git push' }, options),
  ).toThrow(/could not acquire/)
})

it('does not follow a symbolic link while inspecting a lock owner', async () => {
  const directory = await temporaryDirectory()
  const outside = await temporaryDirectory()
  const options = { directory }
  recordFriction('linked-lock', { type: 'tool-result', command: 'echo ok' }, options)
  const file = (await readdir(directory)).find((value) => value.endsWith('.jsonl'))!
  const target = join(outside, 'owner')
  await writeFile(target, '2147483647')
  await symlink(target, join(directory, `${file}.lock`))
  expect(() => readFrictionLog('linked-lock', options)).toThrow(/lock must be a regular file/)
  expect(await readFile(target, 'utf8')).toBe('2147483647')
  await rm(join(directory, `${file}.lock`))
  await writeFile(join(directory, `${file}.lock`), 'x'.repeat(33))
  expect(() => readFrictionLog('linked-lock', options)).toThrow(/could not acquire/)
})

it('requires loopback hostnames to end at a hostname boundary', () => {
  expect(classifyFrictionObservation({ type: 'permission-request', command: '&&' })).toBeNull()
  for (const hostname of ['localhost.example.com', '127.0.0.1.example.com'])
    expect(
      classifyFrictionObservation({
        type: 'tool-result',
        command: 'curl remote',
        structuredStderr: `connect ECONNREFUSED ${hostname}:443`,
      }),
    ).toBeNull()
})

it('does not recognize IPv6 loopback embedded in remote-looking tokens', () => {
  for (const hostname of ['foo.::1', 'foo[::1].example'])
    expect(
      classifyFrictionObservation({
        type: 'tool-result',
        command: 'curl remote',
        structuredStderr: `connect ECONNREFUSED ${hostname}:443`,
      }),
    ).toBeNull()
  expect(
    classifyFrictionObservation({
      type: 'tool-result',
      command: 'node server',
      structuredStderr: 'connect ECONNREFUSED ::1:3000',
    }),
  ).toMatchObject({ kind: 'sandbox-failure' })
})

it('bounds structured stderr inspection', () => {
  expect(
    classifyFrictionObservation({
      type: 'tool-result',
      command: 'node test',
      structuredStderr: `${'x'.repeat(50_000)} EPERM ${'x'.repeat(50_000)}`,
    }),
  ).toBeNull()
  expect(
    classifyFrictionObservation({
      type: 'tool-result',
      command: 'node test',
      structuredStderr: `${'x'.repeat(100_000)} EPERM`,
    }),
  ).toMatchObject({ kind: 'sandbox-failure', detail: 'stderr matched "EPERM"' })
})

it('bounds command inspection before normalization', () => {
  expect(
    classifyFrictionObservation({
      type: 'permission-request',
      command: `npm run build ${'x'.repeat(10_001)}`,
    }),
  ).toMatchObject({ commandPrefix: 'npm run build' })
  expect(
    classifyFrictionObservation({
      type: 'permission-request',
      command: `${'x'.repeat(9_999)}\ud83d\udca5 trailing`,
    })?.commandPrefix,
  ).not.toContain('\ufffd')
})

it('preserves detail pairs and separates lone carriage-return diagnostics', () => {
  expect(
    classifyFrictionObservation({
      type: 'tool-result',
      command: 'git push',
      escalationDetail: `${'x'.repeat(999)}😀`,
    })?.detail,
  ).toBe('x'.repeat(999))
  expect(
    classifyFrictionObservation({
      type: 'tool-result',
      command: 'curl remote',
      structuredStderr: 'ECONNREFUSED 10.0.0.5\runrelated localhost note',
    }),
  ).toBeNull()
})

it('preserves Unicode pairs in bounded details and rejects malformed runtime stderr', () => {
  expect(
    classifyFrictionObservation({
      type: 'tool-result',
      command: 'git push',
      escalationDetail: `${'x'.repeat(999)}\ud83d\ude00`,
    })?.detail,
  ).toBe('x'.repeat(999))
  expect(
    classifyFrictionObservation({
      type: 'tool-result',
      command: 'git push',
      structuredStderr: 42,
    } as unknown as FrictionObservation),
  ).toBeNull()
  expect(
    classifyFrictionObservation({
      type: 'tool-result',
      command: 'git push',
      escalationDetail: 42,
    } as unknown as FrictionObservation),
  ).toBeNull()
  expect(
    classifyFrictionObservation({
      type: 'tool-result',
      command: 42,
    } as unknown as FrictionObservation),
  ).toBeNull()
  expect(
    classifyFrictionObservation({
      type: 'tool-result',
      command: 'node server',
      structuredStderr: 'ECONNREFUSED 10.0.0.5\runrelated localhost note',
    }),
  ).toBeNull()
})
