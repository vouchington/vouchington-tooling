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
    // oxlint-disable-next-line no-mistakes/ts-no-const-aliases -- retain captured process output when adapting the integration failure
    const result = error as { stderr?: string; stdout?: string }
    throw new Error(`pnpm-install fixture failed:\n${result.stdout ?? ''}${result.stderr ?? ''}`)
  }
}

async function logLines(filename: string) {
  try {
    return (await readFile(filename, 'utf8')).trim().split('\n').filter(Boolean)
  } catch {
    return []
  }
}

describe('pnpm install with a real registry fixture', () => {
  it(
    'finalizes script-disabled build debt through pnpm before refreshing the v5 stamp',
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
              "node -e \"require('node:fs').appendFileSync(process.env.POSTINSTALL_LOG, 'dependency\\n')\"",
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
            scripts: {
              postinstall:
                "node -e \"require('node:fs').appendFileSync(process.env.POSTINSTALL_LOG, 'workspace\\n')\"",
            },
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
        expect(await logLines(postinstallLog)).toEqual([])

        await runInstaller(root, true, postinstallLog, storeDirectory)
        expect(tarballFetches).toBe(1)
        expect((await logLines(postinstallLog)).toSorted()).toEqual(['dependency', 'workspace'])
        await expect(
          readFile(join(root, 'node_modules', '.modules.yaml'), 'utf8'),
        ).resolves.toContain('"pendingBuilds": []')
        expect(
          JSON.parse(
            await readFile(
              join(root, 'node_modules', '.pnpm-install-metadata-health.json'),
              'utf8',
            ),
          ),
        ).toMatchObject({ scriptsEnabledInstallVerified: true, version: 5 })

        const stampPath = join(root, 'node_modules', '.pnpm-install-metadata-health.json')
        const oldStamp = JSON.parse(await readFile(stampPath, 'utf8')) as Record<string, unknown>
        oldStamp.version = 4
        await writeFile(stampPath, `${JSON.stringify(oldStamp)}\n`)
        await rm(postinstallLog, { force: true })
        await runInstaller(root, true, postinstallLog, storeDirectory)
        expect((await logLines(postinstallLog)).toSorted()).toEqual(['dependency', 'workspace'])

        await writeFile(
          join(root, 'package.json'),
          `${await readFile(join(root, 'package.json'), 'utf8')} `,
        )
        await rm(postinstallLog, { force: true })
        await runInstaller(root, true, postinstallLog, storeDirectory)
        expect((await logLines(postinstallLog)).toSorted()).toEqual(['dependency', 'workspace'])
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        )
      }
    },
  )
})
