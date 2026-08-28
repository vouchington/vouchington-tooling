import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'

import { ensurePrivateDirectory } from './directory.mts'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((value) => rm(value, { force: true, recursive: true })),
  )
})

it('rejects a non-directory component', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'session-friction-directory-'))
  directories.push(directory)
  const file = join(directory, 'file')
  await writeFile(file, '')
  expect(() => ensurePrivateDirectory(join(file, 'nested'), true)).toThrow(/private directory/)
})
