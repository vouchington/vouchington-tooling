import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { withFileLock } from './lock.mts'

let directory: string
let target: string
let lock: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'file-lock-'))
  target = join(directory, 'records')
  lock = `${target}.lock`
})

afterEach(async () => {
  vi.restoreAllMocks()
  await rm(directory, { force: true, recursive: true })
})

const run = (): string => withFileLock(target, () => 'ran')
const old = new Date(0)

it('runs the action under the lock and releases it afterwards', () => {
  expect(withFileLock(target, () => existsSync(lock))).toBe(true)
  expect(existsSync(lock)).toBe(false)
  expect(() =>
    withFileLock(target, () => {
      throw new Error('boom')
    }),
  ).toThrow('boom')
  expect(existsSync(lock)).toBe(false)
})

it('reclaims an orphaned stale reaper guard', async () => {
  const reaper = `${lock}.reap`
  await writeFile(reaper, '')
  await utimes(reaper, old, old)
  expect(run()).toBe('ran')
  expect(existsSync(reaper)).toBe(false)
})

it('reclaims far-future ownerless locks and reaper guards', async () => {
  const future = new Date(Date.now() + 60_000)
  await writeFile(lock, '')
  await utimes(lock, future, future)
  expect(run()).toBe('ran')
  await writeFile(`${lock}.reap`, '')
  await utimes(`${lock}.reap`, future, future)
  expect(run()).toBe('ran')
})

it('preserves near-future ownerless locks and reaper guards', async () => {
  const future = new Date(Date.now() + 10_000)
  await writeFile(lock, '')
  await utimes(lock, future, future)
  expect(run).toThrow(/could not acquire/)
  await rm(lock)
  await writeFile(`${lock}.reap`, '')
  await utimes(`${lock}.reap`, future, future)
  expect(run).toThrow(/could not acquire/)
})

it('preserves an expired lock owned by a running process', async () => {
  await writeFile(lock, String(process.pid))
  await utimes(lock, old, old)
  expect(run).toThrow(/could not acquire/)
})

it('reclaims stale locks with invalid owner PIDs', async () => {
  for (const owner of [
    '4294967296',
    ` ${process.pid} `,
    `+${process.pid}`,
    `0x${process.pid.toString(16)}`,
    `${process.pid}e0`,
    `0${process.pid}`,
  ]) {
    await writeFile(lock, owner)
    await utimes(lock, old, old)
    expect(run()).toBe('ran')
  }
})

it('does not follow a symbolic link while inspecting a lock owner', async () => {
  const outside = join(directory, 'owner')
  await writeFile(outside, '2147483647')
  await symlink(outside, lock)
  expect(run).toThrow(/lock must be a regular file/)
  expect(await readFile(outside, 'utf8')).toBe('2147483647')
  await rm(lock)
  await writeFile(lock, 'x'.repeat(33))
  expect(run).toThrow(/could not acquire/)
  await utimes(lock, old, old)
  expect(run()).toBe('ran')
})

it('propagates failures other than an existing lock', () => {
  expect(() => withFileLock(join(directory, 'missing', 'records'), () => 'ran')).toThrow(/ENOENT/)
})

it('rejects a non-regular lock without removing it', async () => {
  await mkdir(lock)
  expect(run).toThrow(/lock must be a regular file/)
  expect((await stat(lock)).isDirectory()).toBe(true)
})

it('makes lock acquisition exhaustion explicit for a fresh ownerless lock', async () => {
  await writeFile(lock, '')
  expect(run).toThrow(/could not acquire/)
})

it('recovers a lock whose owner process no longer exists', async () => {
  await writeFile(lock, '2147483647')
  expect(run()).toBe('ran')
})

it('preserves a lock when its owner check is denied, then retries', async () => {
  await writeFile(lock, '2147483647')
  const denied = Object.assign(new Error('denied'), { code: 'EPERM' })
  vi.spyOn(process, 'kill').mockImplementationOnce(() => {
    throw denied
  })
  expect(run()).toBe('ran')
})
