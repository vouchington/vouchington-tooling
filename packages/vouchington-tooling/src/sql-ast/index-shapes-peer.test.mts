import { execFile } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, expect, it } from 'vitest'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

it('imports without the optional peer and rejects an older peer before parsing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sql-index-peer-'))
  directories.push(directory)
  await copyFile(
    new URL('./index-shapes.mts', import.meta.url),
    join(directory, 'index-shapes.mts'),
  )
  await copyFile(
    new URL('./no-mistakes-peer.mts', import.meta.url),
    join(directory, 'no-mistakes-peer.mts'),
  )
  const execute = promisify(execFile)
  const imported = await execute(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import assert from 'node:assert/strict';
    const { extractIndexShapes } = await import('./index-shapes.mts');
    assert.deepEqual(await extractIndexShapes(''), []);
    await assert.rejects(extractIndexShapes('SELECT 1'), { code: 'ERR_MODULE_NOT_FOUND' });
  `,
    ],
    { cwd: directory },
  )
  expect(imported.stderr).toBe('')

  const peer = join(directory, 'node_modules/no-mistakes')
  await mkdir(peer, { recursive: true })
  await writeFile(
    join(peer, 'package.json'),
    JSON.stringify({ version: '0.78.0', main: 'index.js' }),
  )
  await writeFile(join(peer, 'index.js'), 'throw new Error("older parser must not load")')
  const rejected = await execute(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import assert from 'node:assert/strict';
    const { extractIndexShapes } = await import('./index-shapes.mts');
    await assert.rejects(extractIndexShapes('SELECT 1'), {
      message: 'extractIndexShapes requires no-mistakes >=0.81.0',
    });
  `,
    ],
    { cwd: directory },
  )
  expect(rejected.stderr).toBe('')
})
