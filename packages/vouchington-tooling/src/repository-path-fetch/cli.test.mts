import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runRepositoryPathFetch } from './cli.mts'

const tokenEnvironment = 'REPOSITORY_PATH_FETCH_TEST_TOKEN'

function blobSha(content: string): string {
  return createHash('sha1')
    .update(`blob ${Buffer.byteLength(content)}\0`)
    .update(content)
    .digest('hex')
}

function args(root: string): string[] {
  return [
    '--config',
    join(root, 'config.json'),
    '--destination',
    join(root, 'bundle'),
    '--metadata',
    join(root, 'metadata.json'),
    '--token-env',
    tokenEnvironment,
  ]
}

function writeConfig(root: string): void {
  writeFileSync(
    join(root, 'config.json'),
    JSON.stringify({
      paths: [{ destination: 'target', source: 'source' }],
      ref: 'main',
      repository: 'owner/repository',
      schemaVersion: 1,
    }),
  )
}

afterEach(() => {
  delete process.env[tokenEnvironment]
  delete process.env.GITHUB_API_URL
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('runRepositoryPathFetch', () => {
  it('fetches a configured bundle and prints immutable metadata', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-fetch-cli-'))
    try {
      writeConfig(root)
      process.env[tokenEnvironment] = 'secret'
      process.env.GITHUB_API_URL = 'https://github.example/api/'
      const resolved = 'a'.repeat(40)
      const tree = 'b'.repeat(40)
      const content = 'content'
      const blob = blobSha(content)
      const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        expect(url).toContain('github.example')
        const body = url.includes('/commits/')
          ? { commit: { tree: { sha: tree } }, sha: resolved }
          : url.includes('/git/trees/')
            ? { tree: [{ mode: '100644', path: 'source/file', sha: blob, type: 'blob' }] }
            : { content: Buffer.from(content).toString('base64'), encoding: 'base64' }
        return Promise.resolve(new Response(JSON.stringify(body)))
      })
      vi.stubGlobal('fetch', fetchMock)
      const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

      await expect(runRepositoryPathFetch(args(root))).resolves.toBe(0)

      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(String(stdout.mock.calls.at(-1)?.[0])).toContain(`"resolvedSha":"${resolved}"`)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it.each([
    { args: [], message: 'token environment variable name is invalid' },
    { args: ['--wat', 'value'], message: 'expected --config' },
    { args: ['--config'], message: 'expected --config' },
    { args: ['--config', 'a', '--config', 'b'], message: 'expected --config' },
    {
      args: ['--token-env', 'lowercase'],
      message: 'token environment variable name is invalid',
    },
    { args: ['--token-env', tokenEnvironment], message: 'expected --config' },
  ])('rejects malformed CLI arguments', async ({ args: invalidArgs, message }) => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    await expect(runRepositoryPathFetch(invalidArgs)).resolves.toBe(1)
    expect(String(stderr.mock.calls.at(-1)?.[0])).toContain(message)
  })

  it('rejects invalid outputs, existing output, missing tokens, and invalid config', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-fetch-cli-'))
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      writeConfig(root)
      const validArgs = args(root)
      await expect(
        runRepositoryPathFetch([...validArgs.slice(0, 3), 'relative', ...validArgs.slice(4)]),
      ).resolves.toBe(1)
      expect(String(stderr.mock.calls.at(-1)?.[0])).toContain('normalized non-root absolute path')

      mkdirSync(join(root, 'bundle'))
      await expect(runRepositoryPathFetch(validArgs)).resolves.toBe(1)
      expect(String(stderr.mock.calls.at(-1)?.[0])).toContain('output already exists')
      rmSync(join(root, 'bundle'), { recursive: true })

      await expect(runRepositoryPathFetch(validArgs)).resolves.toBe(1)
      expect(String(stderr.mock.calls.at(-1)?.[0])).toContain('environment variable is empty')

      process.env[tokenEnvironment] = 'secret'
      writeFileSync(join(root, 'config.json'), '{')
      await expect(runRepositoryPathFetch(validArgs)).resolves.toBe(1)
      expect(String(stderr.mock.calls.at(-1)?.[0])).toContain('Expected property name')
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('recovers a valid interrupted marker before failing fast on output checks', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-fetch-cli-'))
    try {
      const destination = join(root, 'bundle')
      const metadata = join(root, 'metadata.json')
      const marker = join(root, '.bundle.fetch-incomplete')
      mkdirSync(destination)
      writeFileSync(metadata, '{}')
      const destinationStat = lstatSync(destination, { bigint: true })
      const metadataStat = lstatSync(metadata, { bigint: true })
      writeFileSync(
        marker,
        `${JSON.stringify({ bundleIdentity: { dev: String(destinationStat.dev), ino: String(destinationStat.ino), type: 'directory' }, createdAt: Date.now(), destination, metadata, metadataIdentity: { dev: String(metadataStat.dev), ino: String(metadataStat.ino), type: 'file' }, owner: 2147483647, token: '00000000-0000-4000-8000-000000000000', version: 1 })}\n`,
      )
      const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
      await expect(runRepositoryPathFetch(args(root))).resolves.toBe(1)
      expect(existsSync(destination)).toBe(false)
      expect(existsSync(metadata)).toBe(false)
      expect(String(stderr.mock.calls.at(-1)?.[0])).toContain('environment variable is empty')
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('reports non-Error fetch failures', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-fetch-cli-'))
    try {
      writeConfig(root)
      process.env[tokenEnvironment] = 'secret'
      vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue('network failure'))
      const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
      await expect(runRepositoryPathFetch(args(root))).resolves.toBe(1)
      expect(String(stderr.mock.calls.at(-1)?.[0])).toContain('network failure')
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })
})
