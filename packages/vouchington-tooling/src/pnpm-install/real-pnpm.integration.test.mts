import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const installer = join(process.cwd(), 'packages/vouchington-tooling/src/cli/index.mts')
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

async function runInstaller(
  root: string,
  installScripts: boolean,
  postinstallLog: string,
  storeDirectory: string,
) {
  try {
    return await execFileAsync(
      'node',
      [
        '--experimental-strip-types',
        installer,
        'pnpm-install',
        '--runner-lifecycle',
        'persistent',
        '--install-scripts',
        String(installScripts),
        '--command-timeout-seconds',
        '30',
        '--max-attempts',
        '1',
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          pnpm_config_store_dir: storeDirectory,
          POSTINSTALL_LOG: postinstallLog,
        },
      },
    )
  } catch (error) {
    const result = error as { stderr?: string; stdout?: string }
    throw new Error(`pnpm-install fixture failed:\n${result.stdout ?? ''}${result.stderr ?? ''}`)
  }
}

async function lineCount(filename: string) {
  try {
    return (await readFile(filename, 'utf8')).trim().split('\n').filter(Boolean).length
  } catch {
    return 0
  }
}

describe('pnpm install with a real registry fixture', () => {
  it(
    'does not refetch tarballs or rerun postinstall across warm true-to-false-to-true transitions',
    { timeout: 30_000 },
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'pnpm-install-real-'))
      roots.push(root)
      const dependency = join(root, 'dependency')
      const packed = join(root, 'packed')
      const postinstallLog = join(root, 'postinstall.log')
      const storeDirectory = join(root, 'store')
      await mkdir(dependency)
      await writeFile(
        join(dependency, 'package.json'),
        JSON.stringify({
          name: '@fixture/postinstall',
          scripts: {
            postinstall:
              "node -e \"require('node:fs').appendFileSync(process.env.POSTINSTALL_LOG, 'postinstall\\n')\"",
          },
          version: '1.0.0',
        }),
      )
      await writeFile(join(dependency, 'index.js'), 'module.exports = 1\n')
      await execFileAsync('pnpm', ['pack', '--pack-destination', packed], { cwd: dependency })
      const tarball = await readFile(join(packed, 'fixture-postinstall-1.0.0.tgz'))
      let tarballFetches = 0
      const server = createServer((request, response) => {
        if (request.url !== '/fixture-postinstall-1.0.0.tgz') return response.writeHead(404).end()
        tarballFetches += 1
        response.writeHead(200, { 'content-type': 'application/gzip' })
        response.end(tarball)
      })
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      try {
        const address = server.address()
        if (!address || typeof address === 'string')
          throw new Error('fixture server has no TCP port')
        const tarballUrl = `http://127.0.0.1:${address.port}/fixture-postinstall-1.0.0.tgz`
        await writeFile(
          join(root, 'package.json'),
          JSON.stringify({
            dependencies: { '@fixture/postinstall': tarballUrl },
            name: 'real-pnpm-fixture',
            private: true,
            version: '1.0.0',
          }),
        )
        await writeFile(
          join(root, 'pnpm-workspace.yaml'),
          `allowBuilds:\n  '@fixture/postinstall@${tarballUrl}': true\npackages:\n  - '.'\n`,
        )
        await execFileAsync('pnpm', ['install', '--lockfile-only', '--store-dir', storeDirectory], {
          cwd: root,
        })
        tarballFetches = 0

        await runInstaller(root, false, postinstallLog, storeDirectory)
        expect(tarballFetches).toBe(1)
        expect(await lineCount(postinstallLog)).toBe(0)

        await runInstaller(root, true, postinstallLog, storeDirectory)
        expect(tarballFetches).toBe(1)
        expect(await lineCount(postinstallLog)).toBe(1)

        await runInstaller(root, false, postinstallLog, storeDirectory)
        await runInstaller(root, true, postinstallLog, storeDirectory)
        expect(tarballFetches).toBe(1)
        expect(await lineCount(postinstallLog)).toBe(1)
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        )
      }
    },
  )
})
