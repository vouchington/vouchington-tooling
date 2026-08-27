import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchRepositoryPaths } from './fetch.mts'

function blobSha(content: string): string {
  return createHash('sha1')
    .update(`blob ${Buffer.byteLength(content)}\0`)
    .update(content)
    .digest('hex')
}

afterEach(() => vi.unstubAllGlobals())

describe('fetchRepositoryPaths', () => {
  it('fetches only mapped blobs and reports a resolved SHA and digest', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-fetch-'))
    try {
      const resolved = 'a'.repeat(40)
      const tree = 'b'.repeat(40)
      const blob = blobSha('content')
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>().mockImplementation((input) => {
          const path =
            typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
          const body = path.endsWith('/commits/main')
            ? { commit: { tree: { sha: tree } }, sha: resolved }
            : path.includes('/git/trees/')
              ? {
                  tree: [
                    { mode: '040000', path: 'source', sha: tree, type: 'tree' },
                    { mode: '100755', path: 'source/file.txt', sha: blob, type: 'blob' },
                  ],
                }
              : { content: Buffer.from('content').toString('base64'), encoding: 'base64' }
          return Promise.resolve(new Response(JSON.stringify(body)))
        }),
      )
      const destination = join(root, 'bundle')
      const previousUmask = process.umask(0o077)
      const result = await fetchRepositoryPaths({
        apiUrl: 'https://api.github.com/',
        config: {
          paths: [{ destination: 'target', source: 'source' }],
          ref: 'main',
          repository: 'owner/repository',
          schemaVersion: 1,
        },
        destination,
        metadata: join(root, 'bundle.json'),
        token: 'secret',
      })
      expect(result).toMatchObject({ resolvedSha: resolved, schemaVersion: 1 })
      expect(result.digest).toMatch(/^[0-9a-f]{64}$/)
      process.umask(previousUmask)
      expect(result.files).toEqual([
        { destination: 'target/file.txt', mode: '0755', sha256: expect.any(String) },
      ])
      expect(readFileSync(join(destination, 'target/file.txt'), 'utf8')).toBe('content')
      expect(statSync(destination).mode & 0o077).toBe(0)
      expect(JSON.parse(readFileSync(join(root, 'bundle.json'), 'utf8'))).toMatchObject(result)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('rejects unsafe API paths and modes without publishing outputs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-fetch-'))
    try {
      const sha = 'a'.repeat(40)
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>().mockImplementation((input) => {
          const path =
            typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
          const body = path.endsWith('/commits/main')
            ? { commit: { tree: { sha } }, sha }
            : { tree: [{ mode: '120000', path: 'source/link', sha, type: 'blob' }] }
          return Promise.resolve(new Response(JSON.stringify(body)))
        }),
      )
      const destination = join(root, 'bundle')
      const metadata = join(root, 'bundle.json')
      await expect(
        fetchRepositoryPaths({
          apiUrl: 'https://api.github.com/',
          config: {
            paths: [{ destination: 'target', source: 'source' }],
            ref: 'main',
            repository: 'owner/repository',
            schemaVersion: 1,
          },
          destination,
          metadata,
          token: 'secret',
        }),
      ).rejects.toThrow()
      expect(existsSync(destination)).toBe(false)
      expect(existsSync(metadata)).toBe(false)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('requires a blob for every mapping while ignoring unrelated source entries', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-fetch-'))
    try {
      const sha = 'a'.repeat(40)
      const blob = blobSha('content')
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>().mockImplementation((input) => {
          const path =
            typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
          const body = path.endsWith('/commits/main')
            ? { commit: { tree: { sha } }, sha }
            : path.includes('/git/trees/')
              ? {
                  tree: [
                    { mode: '100644', path: 'files/item', sha: blob, type: 'blob' },
                    { mode: '040000', path: 'empty', sha, type: 'tree' },
                    { mode: '120000', path: 'unrelated-link', sha, type: 'blob' },
                  ],
                }
              : { content: Buffer.from('content').toString('base64'), encoding: 'base64' }
          return Promise.resolve(new Response(JSON.stringify(body)))
        }),
      )
      const destination = join(root, 'bundle')
      const metadata = join(root, 'bundle.json')
      await expect(
        fetchRepositoryPaths({
          apiUrl: 'https://api.github.com/',
          config: {
            paths: [
              { destination: 'files', source: 'files' },
              { destination: 'empty', source: 'empty' },
            ],
            ref: 'main',
            repository: 'owner/repository',
            schemaVersion: 1,
          },
          destination,
          metadata,
          token: 'secret',
        }),
      ).rejects.toThrow('source path contains no files')
      expect(existsSync(destination)).toBe(false)
      expect(existsSync(metadata)).toBe(false)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('rejects malformed blob responses', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-fetch-'))
    try {
      const sha = 'a'.repeat(40)
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>().mockImplementation((input) => {
          const path =
            typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
          const body = path.endsWith('/commits/main')
            ? { commit: { tree: { sha } }, sha }
            : path.includes('/git/trees/')
              ? { tree: [{ mode: '100644', path: 'source/file', sha, type: 'blob' }] }
              : { content: 'not-base64!', encoding: 'base64' }
          return Promise.resolve(new Response(JSON.stringify(body)))
        }),
      )
      await expect(
        fetchRepositoryPaths({
          apiUrl: 'https://api.github.com/',
          config: {
            paths: [{ destination: 'target', source: 'source' }],
            ref: 'main',
            repository: 'owner/repository',
            schemaVersion: 1,
          },
          destination: join(root, 'bundle'),
          metadata: join(root, 'bundle.json'),
          token: 'secret',
        }),
      ).rejects.toThrow('invalid blob encoding')
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })
})
