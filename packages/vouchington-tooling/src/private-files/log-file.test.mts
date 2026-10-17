import { closeSync, constants } from 'node:fs'
import { link, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'

import { openLogFile, readLogContent, writeAll } from './log-file.mts'

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'log-file-'))
})

afterEach(() => rm(directory, { force: true, recursive: true }))

function readAll(path: string, maximumBytes: number): string {
  const descriptor = openLogFile(path, constants.O_RDONLY)
  try {
    return readLogContent(descriptor, maximumBytes)
  } finally {
    closeSync(descriptor)
  }
}

it('writes and reads back a regular file within the limit', () => {
  const path = join(directory, 'record')
  const descriptor = openLogFile(path, constants.O_WRONLY | constants.O_CREAT)
  writeAll(descriptor, 'héllo\n')
  closeSync(descriptor)
  expect(readAll(path, 100)).toBe('héllo\n')
})

it('rejects a symlink, a directory, and a multiply-linked file', async () => {
  const real = join(directory, 'real')
  await writeFile(real, 'x')
  await symlink(real, join(directory, 'symlink'))
  await mkdir(join(directory, 'dir'))
  await link(real, join(directory, 'hardlink'))
  for (const name of ['symlink', 'dir', 'real', 'hardlink', 'real/child'])
    expect(() => openLogFile(join(directory, name), constants.O_RDONLY)).toThrow(/regular file/)
})

it('rethrows other open failures unchanged', () => {
  expect(() => openLogFile(join(directory, 'missing'), constants.O_RDONLY)).toThrow(/ENOENT/)
})

it('rejects content over the byte limit', async () => {
  const path = join(directory, 'large')
  await writeFile(path, 'x'.repeat(11))
  expect(() => readAll(path, 10)).toThrow(/too large/)
  expect(readAll(path, 11)).toBe('x'.repeat(11))
})

it('rejects invalid UTF-8', async () => {
  const path = join(directory, 'binary')
  await writeFile(path, Buffer.from([0x7b, 0x22, 0x80, 0x22, 0x7d]))
  expect(() => readAll(path, 100)).toThrow(/not valid UTF-8/)
})
