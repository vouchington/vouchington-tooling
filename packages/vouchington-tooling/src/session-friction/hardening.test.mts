import { existsSync } from 'node:fs'
import {
  chmod,
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
